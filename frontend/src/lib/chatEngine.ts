/**
 * Which Chat answers on the job page: the classic one or the new single-agent
 * Chat (beta). The choice is per browser. `?chat=new` / `?chat=classic` in the
 * URL sets it too, so a link can switch someone over.
 */
export type ChatEngine = 'agent' | 'classic';

const KEY = 'atmosphere.chatEngine';

export function readChatEngine(): ChatEngine {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('chat');
    if (fromUrl === 'new' || fromUrl === 'agent') {
      window.localStorage.setItem(KEY, 'agent');
      return 'agent';
    }
    if (fromUrl === 'classic' || fromUrl === 'old') {
      window.localStorage.setItem(KEY, 'classic');
      return 'classic';
    }
    return window.localStorage.getItem(KEY) === 'agent' ? 'agent' : 'classic';
  } catch {
    return 'classic';
  }
}

export function writeChatEngine(engine: ChatEngine): void {
  try {
    window.localStorage.setItem(KEY, engine);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}
