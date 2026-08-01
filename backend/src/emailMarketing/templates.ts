/**
 * Email templates for storm alerts and post-storm check-ins.
 *
 * Plain text on purpose: restoration salespeople write like people, not like
 * marketing platforms, and plain text survives every inbox.
 */

import type { EmSettings, RenderedEmail, StormMatch } from './types.js';

export interface TemplateContext {
  contactFirstName: string;
  contactName: string;
  city: string;
  region: string;
  stormName: string;
  eventType: string;
  headline: string;
  areaDesc: string;
  companyName: string;
  signature: string;
  includeOffer: boolean;
}

function firstNameOf(fullName: string): string {
  const part = fullName.trim().split(/\s+/)[0];
  return part && part.length > 0 ? part : 'there';
}

export function buildTemplateContext(
  match: Pick<StormMatch, 'name' | 'city' | 'region'>,
  storm: {
    name: string;
    eventType: string;
    headline?: string | null;
    areaDesc?: string | null;
  },
  settings: Pick<EmSettings, 'fromName' | 'companySignature' | 'includeOfferOfHelp'>,
): TemplateContext {
  return {
    contactFirstName: firstNameOf(match.name),
    contactName: match.name,
    city: match.city?.trim() || 'your area',
    region: match.region?.trim() || '',
    stormName: storm.name,
    eventType: storm.eventType,
    headline: storm.headline?.trim() || storm.name,
    areaDesc: storm.areaDesc?.trim() || match.city?.trim() || 'your area',
    companyName: settings.fromName,
    signature: settings.companySignature?.trim() || settings.fromName,
    includeOffer: settings.includeOfferOfHelp,
  };
}

/** Default subject / body used when drafting a storm outreach run. */
export function defaultStormTemplates(_storm?: {
  eventType: string;
  name: string;
}): {
  subjectTemplate: string;
  bodyTemplate: string;
} {
  return {
    subjectTemplate: `Checking in — {{eventType}} near {{city}}`,
    bodyTemplate: [
      `Hi {{contactFirstName}},`,
      ``,
      `I wanted to reach out personally. There is a {{eventType}} affecting {{areaDesc}}`,
      `({{stormName}}), and I know weather like this can be stressful.`,
      ``,
      `{{offer}}`,
      ``,
      `No pressure either way — just reply to this email or give us a call if you`,
      `need anything. We are here.`,
      ``,
      `Take care,`,
      `{{signature}}`,
    ].join('\n'),
  };
}

export function defaultCheckinTemplates(): {
  subjectTemplate: string;
  bodyTemplate: string;
} {
  return {
    subjectTemplate: `Following up after the storm — is everything alright?`,
    bodyTemplate: [
      `Hi {{contactFirstName}},`,
      ``,
      `Just checking in after the recent {{eventType}} near {{city}}.`,
      `Hoping you and your property came through okay.`,
      ``,
      `If you noticed any water intrusion, roof damage, or anything that does not`,
      `feel right, we can send someone out quickly — often the same day.`,
      ``,
      `Reply to this email anytime. Glad to help.`,
      ``,
      `{{signature}}`,
    ].join('\n'),
  };
}

function renderOffer(includeOffer: boolean): string {
  if (!includeOffer) {
    return 'If there is anything at all we can do to help, just say the word.';
  }
  return [
    'If you need help — tarping, water extraction, a walkthrough to document',
    'damage for insurance — we can get a crew to you as soon as it is safe.',
  ].join(' ');
}

/** Tiny {{token}} interpolator. Unknown tokens are left alone. */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  const values: Record<string, string> = {
    contactFirstName: ctx.contactFirstName,
    contactName: ctx.contactName,
    city: ctx.city,
    region: ctx.region,
    stormName: ctx.stormName,
    eventType: ctx.eventType,
    headline: ctx.headline,
    areaDesc: ctx.areaDesc,
    companyName: ctx.companyName,
    signature: ctx.signature,
    offer: renderOffer(ctx.includeOffer),
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) => {
    return key in values ? values[key]! : `{{${key}}}`;
  });
}

export function renderStormEmail(
  subjectTemplate: string,
  bodyTemplate: string,
  ctx: TemplateContext,
): RenderedEmail {
  return {
    subject: renderTemplate(subjectTemplate, ctx).replace(/\s+/g, ' ').trim(),
    bodyText: renderTemplate(bodyTemplate, ctx).trim(),
  };
}
