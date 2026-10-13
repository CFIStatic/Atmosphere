import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { COMPUTER_RESUME_EVENT, computerTaskRef } from '../../lib/computer';
import { ComputerTaskCard } from './ComputerTaskCard';

const computerLogins = vi.fn();
const computerStartSignIn = vi.fn();
const computerSignInDone = vi.fn();

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      computerLogins: (...a: unknown[]) => computerLogins(...a),
      computerStartSignIn: (...a: unknown[]) => computerStartSignIn(...a),
      computerSignInDone: (...a: unknown[]) => computerSignInDone(...a),
    },
  };
});

function path(prompt: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(prompt)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `computer-task:add-login:${b64}`;
}

const PROMPT = {
  n: 'Acme Claims Hub',
  u: 'https://portal.acmeclaimshub.test/login',
  h: 'portal.acmeclaimshub.test',
  q: 'can you log in to acme claims hub and tell me what claims are open',
  w: 1,
};

describe('in-thread add-login card', () => {
  beforeEach(() => {
    computerLogins.mockReset().mockResolvedValue({
      configured: true,
      message: null,
      logins: [],
      signingIn: null,
      busy: null,
      passwords: { enabled: true, message: null, canManage: true },
    });
    computerStartSignIn.mockReset();
    computerSignInDone.mockReset();
  });

  it('parses the prompt path', () => {
    const ref = computerTaskRef(path(PROMPT));
    expect(ref).toEqual({
      kind: 'add_login',
      prompt: { name: 'Acme Claims Hub', url: PROMPT.u, host: PROMPT.h, question: PROMPT.q, foundWithWebSearch: true },
    });
    expect(computerTaskRef(path({ ...PROMPT, u: 'javascript:alert(1)' }))).toEqual({ kind: 'error' });
  });

  it('saves the login to Logins (not chat) and resumes the original request', async () => {
    computerStartSignIn.mockResolvedValue({
      signIn: { sessionId: 's1', label: 'Acme Claims Hub', url: PROMPT.u, host: PROMPT.h, loginId: 'l1', startedAt: '', startedBy: null, startedByYou: true, expiresAt: '', autoSignIn: { outcome: 'signed_in', message: 'Signed in.' } },
    });
    computerSignInDone.mockResolvedValue({ login: { id: 'l1' } });
    const resumed: string[] = [];
    const onResume = (e: Event) => resumed.push((e as CustomEvent<{ text: string }>).detail.text);
    window.addEventListener(COMPUTER_RESUME_EVENT, onResume);
    render(<ComputerTaskCard path={path(PROMPT)} />);
    expect(screen.getByText('Acme Claims Hub')).toBeTruthy();
    expect(screen.getByText(/found with a web search/)).toBeTruthy();
    await userEvent.type(await screen.findByLabelText(/Email or username/), 'office@jettx.test');
    const pw = screen.getByLabelText(/^Password/) as HTMLInputElement;
    expect(pw.type).toBe('password');
    await userEvent.type(pw, 'hunter2');
    await userEvent.type(screen.getByLabelText(/Company ID/), 'JETTX');
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(screen.getByTestId('chat-add-login-saved')).toBeTruthy());
    expect(computerStartSignIn).toHaveBeenCalledWith({
      url: PROMPT.u,
      label: 'Acme Claims Hub',
      credential: { username: 'office@jettx.test', password: 'hunter2', companyId: 'JETTX' },
    });
    expect(computerSignInDone).toHaveBeenCalledWith('s1');
    expect(resumed).toEqual([PROMPT.q]);
    window.removeEventListener(COMPUTER_RESUME_EVENT, onResume);
  });
});
