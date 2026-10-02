import { describe, expect, it } from 'vitest';
import { campaignMarkdownToText, renderCampaignMarkdown } from './campaignMarkdown';

// Same fixtures as backend/test/atmosphereAnalytics.test.ts so preview == sent email.
describe('campaign markdown (client preview)', () => {
  it('escapes HTML and only allows safe links', () => {
    const html = renderCampaignMarkdown(
      '# Hello <b>there</b>\n\nA **bold** and *quiet* line with [a link](https://example.test/x?a=1&b=2).\n\n- one\n- [bad](javascript:alert(1))\n\n<script>alert(1)</script>',
    );
    expect(html).toMatch(/<h1>Hello &lt;b&gt;there&lt;\/b&gt;<\/h1>/);
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toMatch(/<em>quiet<\/em>/);
    expect(html).toMatch(/<a href="https:\/\/example.test\/x\?a=1&amp;b=2">a link<\/a>/);
    expect(html).toMatch(/<ul><li>one<\/li><li>\[bad\]\(javascript:alert\(1\)\)<\/li><\/ul>/);
    expect(html).not.toMatch(/<script>/);
    expect(campaignMarkdownToText('# Hi\n\n**Bold** [x](https://example.test)')).toBe('Hi\n\nBold x (https://example.test)');
  });
});
