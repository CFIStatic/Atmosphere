/**
 * Which Chat answers on the job page. Everyone gets the agent Chat. The
 * classic Chat is an emergency escape only: `?chat=classic` in the URL turns
 * it on for this browser, `?chat=new` turns it back off. There is no switch in
 * the Chat box.
 */
export type ChatEngine = 'agent' | 'classic';

// A new key: choices made during the beta ("switch back") do not carry over.
const KEY = 'atmosphere.chatEngine.v2';

export function readChatEngine(): ChatEngine {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('chat');
    if (fromUrl === 'classic' || fromUrl === 'old') {
      window.localStorage.setItem(KEY, 'classic');
      return 'classic';
    }
    if (fromUrl === 'new' || fromUrl === 'agent') {
      window.localStorage.removeItem(KEY);
      return 'agent';
    }
    return window.localStorage.getItem(KEY) === 'classic' ? 'classic' : 'agent';
  } catch {
    return 'agent';
  }
}
