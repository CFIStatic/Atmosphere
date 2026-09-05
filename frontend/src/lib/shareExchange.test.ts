import { describe, expect, it, vi } from 'vitest';
import { exchangeShareToken, guestPathAfterExchange } from './shareExchange';

describe('guestPathAfterExchange', () => {
  it('strips token query keys and keeps ask=1', () => {
    expect(guestPathAfterExchange('progress', '?token=abc&ask=1')).toBe(
      '/progress-view?ask=1',
    );
    expect(guestPathAfterExchange('job', '?email=a%40b.com')).toBe(
      '/guest?email=a%40b.com',
    );
    expect(guestPathAfterExchange('job', '')).toBe('/guest');
  });
});

describe('exchangeShareToken', () => {
  it('POSTs the token with credentials', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const ok = await exchangeShareToken('job', 'long-enough-token', fetchImpl as unknown as typeof fetch);
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/api/job-share/exchange');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(JSON.parse(String(init?.body))).toEqual({ token: 'long-enough-token' });
  });

  it('returns false when the token is too short or the request fails', async () => {
    expect(await exchangeShareToken('job', 'short')).toBe(false);
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    expect(await exchangeShareToken('progress', 'long-enough-token', fetchImpl as unknown as typeof fetch)).toBe(
      false,
    );
  });
});
