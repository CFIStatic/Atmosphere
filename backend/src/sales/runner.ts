import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserClient } from '../lib/supabase.js';
import { startRun, recordStep, finishRun, auditWriter } from '../lib/auditLog.js';
import {
  DEFAULT_SENDER_NAME,
  DEFAULT_SENDER_ORG,
  DEFAULT_VALUE_PROP,
  demoMeetingDescription,
  demoMeetingTitle,
  resolveCampaignMessaging,
} from './atmosphereProduct.js';
import { researchBusinesses } from './research.js';
import { crawlBusinessContacts } from './crawl.js';
import {
  draftPersonalizedEmail,
  sendEmail,
  classifyReply,
  nextFollowupAt,
  salesFromAddress,
} from './email.js';
import { pickMeetingSlot, buildIcs, formatSlot } from './schedule.js';
import { logSalesEvent } from './serialize.js';
import type { ReplyIntent } from './types.js';

/**
 * Atmosphere internal outreach runner.
 *
 * One campaign advances through research → crawl → outreach → follow-ups →
 * product-demo scheduling. Built so Atmosphere salespeople can automate
 * outbound and spend the day closing customers on demos.
 */

const activeCampaigns = new Set<string>();

async function setCampaign(
  supabase: SupabaseClient,
  campaignId: string,
  patch: Record<string, unknown>,
) {
  await supabase.from('sales_campaigns').update(patch).eq('id', campaignId);
}

export function isCampaignRunning(campaignId: string): boolean {
  return activeCampaigns.has(campaignId);
}

/**
 * Kick the full outbound pipeline for a campaign. Safe to call again after
 * pause — it resumes from follow-ups / unfinished crawl work.
 */
export async function runCampaign(input: {
  accessToken: string;
  orgId: string;
  userId: string;
  campaignId: string;
}): Promise<void> {
  const { accessToken, orgId, userId, campaignId } = input;
  if (activeCampaigns.has(campaignId)) return;
  activeCampaigns.add(campaignId);

  const supabase = createUserClient(accessToken);
  const audit = auditWriter(accessToken);

  try {
    const { data: campaign, error } = await supabase
      .from('sales_campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error || !campaign) {
      activeCampaigns.delete(campaignId);
      return;
    }

    const run = await startRun(audit, {
      orgId,
      agentKey: 'sales_agent',
      title: `Sales Agent: ${campaign.name}`,
      actorType: 'user',
      actorUserId: userId,
      sourceTable: 'sales_campaigns',
      sourceId: campaignId,
      input: {
        territory: campaign.territory,
        salesFocus: campaign.sales_focus,
      },
    });
    const runId = run.ok && run.data ? run.data.id : null;

    if (runId) {
      await setCampaign(supabase, campaignId, {
        agent_run_id: runId,
        started_at: campaign.started_at ?? new Date().toISOString(),
        error: null,
      });
    }

    await logSalesEvent(supabase, {
      orgId,
      campaignId,
      eventType: 'campaign_started',
      detail: `Researching businesses in ${campaign.territory} focused on ${campaign.sales_focus}.`,
    });

    await setCampaign(supabase, campaignId, {
      status: 'researching',
      stage_detail: 'Finding businesses in the territory…',
    });
    if (runId) {
      await recordStep(audit, runId, {
        type: 'tool_call',
        action: 'research_businesses',
        detail: `${campaign.territory} / ${campaign.sales_focus}`,
      });
    }

    const { data: existingBiz } = await supabase
      .from('sales_businesses')
      .select('id')
      .eq('campaign_id', campaignId)
      .limit(1);

    if (!existingBiz?.length) {
      const researched = await researchBusinesses(campaign.territory, campaign.sales_focus);
      for (const b of researched.businesses) {
        const { error: insertErr } = await supabase.from('sales_businesses').insert({
          org_id: orgId,
          campaign_id: campaignId,
          name: b.name,
          category: b.category,
          address: b.address,
          city: b.city,
          region: b.region,
          postal_code: b.postalCode,
          country: b.country,
          phone: b.phone,
          website_url: b.websiteUrl,
          lat: b.lat,
          lng: b.lng,
          source: b.source,
          source_ref: b.sourceRef,
          research_notes: b.researchNotes,
          status: 'discovered',
        });
        if (insertErr) continue;
      }
      await setCampaign(supabase, campaignId, {
        businesses_found: researched.businesses.length,
        stage_detail: `Found ${researched.businesses.length} businesses (${researched.mode}).`,
      });
      await logSalesEvent(supabase, {
        orgId,
        campaignId,
        eventType: 'research_complete',
        detail: `Found ${researched.businesses.length} businesses via ${researched.mode} research.`,
        payload: { mode: researched.mode, count: researched.businesses.length },
      });
      if (runId) {
        await recordStep(audit, runId, {
          type: 'tool_result',
          action: 'research_businesses',
          detail: `${researched.businesses.length} businesses (${researched.mode})`,
          payload: { mode: researched.mode, count: researched.businesses.length },
        });
      }
    }

    await setCampaign(supabase, campaignId, {
      status: 'crawling',
      stage_detail: 'Finding decision-makers…',
    });

    const { data: businesses } = await supabase
      .from('sales_businesses')
      .select('*')
      .eq('campaign_id', campaignId)
      .in('status', ['discovered', 'researching', 'crawling']);

    let contactsFound = 0;
    for (const biz of businesses ?? []) {
      await supabase.from('sales_businesses').update({ status: 'crawling' }).eq('id', biz.id);

      const crawled = await crawlBusinessContacts({
        businessName: biz.name,
        websiteUrl: biz.website_url,
      });

      for (const c of crawled.contacts) {
        const { error: cErr } = await supabase.from('sales_contacts').insert({
          org_id: orgId,
          campaign_id: campaignId,
          business_id: biz.id,
          full_name: c.fullName,
          title: c.title,
          email: c.email,
          phone: c.phone,
          linkedin_url: c.linkedinUrl,
          is_decision_maker: c.isDecisionMaker,
          research_summary: c.researchSummary,
          personalization_hooks: c.personalizationHooks,
          status: c.email ? 'researched' : 'identified',
        });
        if (!cErr) contactsFound += 1;
      }

      await supabase
        .from('sales_businesses')
        .update({
          status: crawled.contacts.some((c) => c.email) ? 'crawling' : 'discovered',
          research_notes: [biz.research_notes, `Crawl mode: ${crawled.mode}`]
            .filter(Boolean)
            .join('\n')
            .slice(0, 8000),
        })
        .eq('id', biz.id);

      await logSalesEvent(supabase, {
        orgId,
        campaignId,
        businessId: biz.id,
        eventType: 'contacts_found',
        detail: `${crawled.contacts.length} contacts at ${biz.name} (${crawled.mode}).`,
      });
    }

    const { count: contactCount } = await supabase
      .from('sales_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);

    await setCampaign(supabase, campaignId, {
      contacts_found: contactCount ?? contactsFound,
      stage_detail: `Identified ${contactCount ?? contactsFound} contacts.`,
    });

    await setCampaign(supabase, campaignId, {
      status: 'outreach',
      stage_detail: 'Sending personalised emails…',
    });

    await sendQueuedOutreach({
      supabase,
      audit,
      runId,
      orgId,
      campaign,
      onlyFresh: true,
    });

    await setCampaign(supabase, campaignId, {
      status: 'following_up',
      stage_detail: 'Working follow-ups and replies…',
    });

    await sendQueuedOutreach({
      supabase,
      audit,
      runId,
      orgId,
      campaign,
      onlyFresh: false,
    });

    const { count: meetings } = await supabase
      .from('sales_meetings')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);

    const { count: sent } = await supabase
      .from('sales_outreach')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('direction', 'outbound')
      .in('status', ['sent', 'simulated']);

    await setCampaign(supabase, campaignId, {
      status: 'following_up',
      emails_sent: sent ?? 0,
      meetings_booked: meetings ?? 0,
      stage_detail:
        'Outreach underway. The agent will keep following up until contacts reply and meetings are booked.',
    });

    if (runId) {
      await finishRun(audit, runId, {
        status: 'succeeded',
        summary: `Campaign active — ${sent ?? 0} emails, ${meetings ?? 0} meetings.`,
      });
    }

    await logSalesEvent(supabase, {
      orgId,
      campaignId,
      eventType: 'pipeline_ready',
      detail: 'Initial research, crawl, and outreach pass complete.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Campaign failed';
    await setCampaign(supabase, campaignId, {
      status: 'failed',
      error: message.slice(0, 4000),
      stage_detail: 'Campaign failed.',
      finished_at: new Date().toISOString(),
    });
    await logSalesEvent(supabase, {
      orgId,
      campaignId,
      actorType: 'system',
      eventType: 'campaign_failed',
      detail: message.slice(0, 4000),
    });
  } finally {
    activeCampaigns.delete(campaignId);
  }
}

async function sendQueuedOutreach(input: {
  supabase: SupabaseClient;
  audit: ReturnType<typeof auditWriter>;
  runId: string | null;
  orgId: string;
  campaign: Record<string, any>;
  onlyFresh: boolean;
}) {
  const { supabase, audit, runId, orgId, campaign, onlyFresh } = input;

  let query = supabase
    .from('sales_contacts')
    .select('*, sales_businesses ( name, address, city )')
    .eq('campaign_id', campaign.id)
    .not('email', 'is', null)
    .neq('status', 'unsubscribed')
    .neq('status', 'meeting_booked')
    .neq('status', 'skipped')
    .neq('status', 'bounced');

  if (onlyFresh) {
    query = query.in('status', ['researched', 'queued']);
  } else {
    query = query
      .in('status', ['emailed', 'followed_up', 'queued'])
      .lte('next_followup_at', new Date().toISOString());
  }

  const { data: contacts } = await query.limit(40);
  if (!contacts?.length) return;

  const messaging = resolveCampaignMessaging({
    salesFocus: campaign.sales_focus,
    valueProp: campaign.value_prop,
    senderName: campaign.sender_name,
    senderOrg: DEFAULT_SENDER_ORG,
  });
  const senderName = messaging.senderName;
  const fromEmail = salesFromAddress(campaign.sender_email);

  for (const contact of contacts) {
    const { count: prior } = await supabase
      .from('sales_outreach')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', contact.id)
      .eq('direction', 'outbound');

    const sequenceStep = (prior ?? 0) + 1;
    if (sequenceStep > 3) continue;

    const businessName =
      (contact.sales_businesses as { name?: string } | null)?.name || 'your company';

    const draft = await draftPersonalizedEmail({
      senderName,
      senderOrg: messaging.senderOrg,
      territory: campaign.territory,
      salesFocus: messaging.salesFocus,
      valueProp: messaging.valueProp || DEFAULT_VALUE_PROP,
      businessName,
      contactName: contact.full_name,
      contactTitle: contact.title,
      researchSummary: contact.research_summary,
      hooks: Array.isArray(contact.personalization_hooks)
        ? contact.personalization_hooks
        : [],
      sequenceStep,
    });

    const delivery = await sendEmail({
      to: contact.email,
      from: fromEmail,
      fromName: senderName,
      subject: draft.subject,
      body: draft.body,
      replyTo: campaign.sender_email,
    });

    await supabase.from('sales_outreach').insert({
      org_id: orgId,
      campaign_id: campaign.id,
      contact_id: contact.id,
      business_id: contact.business_id,
      direction: 'outbound',
      channel: 'email',
      subject: draft.subject,
      body: draft.body,
      sequence_step: sequenceStep,
      status: delivery.status === 'failed' ? 'failed' : delivery.status,
      provider_message_id: delivery.providerMessageId ?? null,
      sent_at: new Date().toISOString(),
    });

    const followUp = nextFollowupAt(new Date(), sequenceStep);
    await supabase
      .from('sales_contacts')
      .update({
        status: sequenceStep === 1 ? 'emailed' : 'followed_up',
        last_touched_at: new Date().toISOString(),
        next_followup_at: followUp ? followUp.toISOString() : null,
      })
      .eq('id', contact.id);

    await supabase
      .from('sales_businesses')
      .update({ status: 'contacted' })
      .eq('id', contact.business_id);

    await logSalesEvent(supabase, {
      orgId,
      campaignId: campaign.id,
      businessId: contact.business_id,
      contactId: contact.id,
      eventType: delivery.status === 'simulated' ? 'email_simulated' : 'email_sent',
      detail: `${delivery.status} step ${sequenceStep} to ${contact.full_name} <${contact.email}>`,
    });

    if (runId) {
      await recordStep(audit, runId, {
        type: 'tool_call',
        action: 'send_email',
        detail: `${contact.email} step ${sequenceStep} (${delivery.status})`,
        target: contact.email,
      });
    }
  }

  const { count: sent } = await supabase
    .from('sales_outreach')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('direction', 'outbound')
    .in('status', ['sent', 'simulated']);

  await setCampaign(supabase, campaign.id, { emails_sent: sent ?? 0 });
}

/**
 * Handle an inbound reply: classify intent, maybe book a meeting, update state.
 */
export async function handleInboundReply(input: {
  accessToken: string;
  orgId: string;
  outreachId: string;
  body: string;
  subject?: string | null;
}): Promise<{ intent: ReplyIntent; meetingId?: string }> {
  const supabase = createUserClient(input.accessToken);

  const { data: original, error } = await supabase
    .from('sales_outreach')
    .select('*, sales_campaigns (*), sales_contacts (*), sales_businesses ( name, address )')
    .eq('id', input.outreachId)
    .eq('org_id', input.orgId)
    .maybeSingle();

  if (error || !original) {
    throw new Error('Outreach message not found');
  }

  const campaign = original.sales_campaigns as Record<string, any>;
  const contact = original.sales_contacts as Record<string, any>;
  const business = original.sales_businesses as { name?: string; address?: string } | null;

  const intent = await classifyReply(input.body);

  await supabase.from('sales_outreach').insert({
    org_id: input.orgId,
    campaign_id: original.campaign_id,
    contact_id: original.contact_id,
    business_id: original.business_id,
    direction: 'inbound',
    channel: 'email',
    subject: input.subject ?? `Re: ${original.subject ?? ''}`.slice(0, 500),
    body: input.body,
    sequence_step: original.sequence_step,
    status: 'replied',
    intent,
    sent_at: new Date().toISOString(),
  });

  await supabase
    .from('sales_outreach')
    .update({ status: 'replied', intent })
    .eq('id', original.id);

  const { count: replies } = await supabase
    .from('sales_outreach')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', original.campaign_id)
    .eq('direction', 'inbound');

  await setCampaign(supabase, original.campaign_id, {
    replies_received: replies ?? 0,
  });

  await logSalesEvent(supabase, {
    orgId: input.orgId,
    campaignId: original.campaign_id,
    businessId: original.business_id,
    contactId: original.contact_id,
    eventType: 'reply_received',
    detail: `Reply classified as ${intent}.`,
    payload: { intent },
  });

  if (intent === 'unsubscribe' || intent === 'not_interested') {
    await supabase
      .from('sales_contacts')
      .update({
        status: intent === 'unsubscribe' ? 'unsubscribed' : 'skipped',
        next_followup_at: null,
      })
      .eq('id', original.contact_id);
    return { intent };
  }

  if (intent === 'ask_later') {
    const later = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await supabase
      .from('sales_contacts')
      .update({ status: 'followed_up', next_followup_at: later.toISOString() })
      .eq('id', original.contact_id);
    return { intent };
  }

  if (intent !== 'interested') {
    await supabase
      .from('sales_contacts')
      .update({ status: 'replied' })
      .eq('id', original.contact_id);
    return { intent };
  }

  await setCampaign(supabase, original.campaign_id, {
    status: 'scheduling',
    stage_detail: `Booking a meeting with ${contact.full_name}…`,
  });

  const { data: existingMeetings } = await supabase
    .from('sales_meetings')
    .select('starts_at')
    .eq('org_id', input.orgId)
    .in('status', ['proposed', 'confirmed']);

  const slot = pickMeetingSlot({
    availability: campaign.availability,
    durationMin: campaign.meeting_duration_min ?? 30,
    busyStarts: (existingMeetings ?? []).map((m) => new Date(m.starts_at)),
  });

  if (!slot) {
    await logSalesEvent(supabase, {
      orgId: input.orgId,
      campaignId: original.campaign_id,
      contactId: original.contact_id,
      eventType: 'schedule_failed',
      detail: 'No open slots in the configured availability window.',
    });
    await supabase
      .from('sales_contacts')
      .update({ status: 'replied' })
      .eq('id', original.contact_id);
    return { intent };
  }

  const title = demoMeetingTitle(business?.name);
  const location = business?.address || campaign.territory || 'Video demo';
  const fromEmail = salesFromAddress(campaign.sender_email);
  const ics = buildIcs({
    title,
    description: demoMeetingDescription(campaign.sales_focus),
    location,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    organizerEmail: fromEmail,
    attendeeEmail: contact.email,
  });

  const { data: meeting, error: meetErr } = await supabase
    .from('sales_meetings')
    .insert({
      org_id: input.orgId,
      campaign_id: original.campaign_id,
      contact_id: original.contact_id,
      business_id: original.business_id,
      title,
      starts_at: slot.startsAt.toISOString(),
      ends_at: slot.endsAt.toISOString(),
      location,
      status: 'confirmed',
      booked_by: 'agent',
      notes: 'Autonomously booked after a positive reply — Atmosphere product demo.',
      ics,
    })
    .select('*')
    .maybeSingle();

  if (meetErr || !meeting) {
    return { intent };
  }

  const confirmBody = `Hi ${contact.full_name.split(' ')[0]},

Great — I've booked an Atmosphere product demo for us:

${formatSlot(slot.startsAt, slot.endsAt)}
Location / join: ${location}

We'll walk through estimators, web access, technician tools, and the audit trail so you can see how it fits ${business?.name ?? 'your team'}. A calendar invite is attached conceptually (ICS stored on the meeting).

– ${campaign.sender_name || DEFAULT_SENDER_NAME}`;

  await sendEmail({
    to: contact.email,
    from: fromEmail,
    fromName: campaign.sender_name,
    subject: `Confirmed: ${title}`,
    body: confirmBody,
  });

  await supabase.from('sales_outreach').insert({
    org_id: input.orgId,
    campaign_id: original.campaign_id,
    contact_id: original.contact_id,
    business_id: original.business_id,
    direction: 'outbound',
    channel: 'email',
    subject: `Confirmed: ${title}`,
    body: confirmBody,
    sequence_step: original.sequence_step,
    status: process.env.RESEND_API_KEY ? 'sent' : 'simulated',
    sent_at: new Date().toISOString(),
  });

  await supabase
    .from('sales_contacts')
    .update({
      status: 'meeting_booked',
      next_followup_at: null,
      last_touched_at: new Date().toISOString(),
    })
    .eq('id', original.contact_id);

  await supabase
    .from('sales_businesses')
    .update({ status: 'meeting_booked' })
    .eq('id', original.business_id);

  const { count: booked } = await supabase
    .from('sales_meetings')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', original.campaign_id);

  await setCampaign(supabase, original.campaign_id, {
    meetings_booked: booked ?? 0,
    status: 'following_up',
    stage_detail: `Meeting booked with ${contact.full_name}. Continuing outreach on remaining contacts.`,
  });

  await logSalesEvent(supabase, {
    orgId: input.orgId,
    campaignId: original.campaign_id,
    businessId: original.business_id,
    contactId: original.contact_id,
    eventType: 'meeting_booked',
    detail: `Booked ${formatSlot(slot.startsAt, slot.endsAt)} with ${contact.full_name}.`,
    payload: { meetingId: meeting.id, startsAt: slot.startsAt.toISOString() },
  });

  return { intent, meetingId: meeting.id as string };
}
