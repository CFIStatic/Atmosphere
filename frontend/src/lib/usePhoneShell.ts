import { useEffect, useState } from 'react';
import { isFieldEmbedMarked, isPhoneShellViewport, PHONE_SHELL_MQ } from './fieldEmbed';

/**
 * Phone-width office chrome: hamburger drawer instead of the 248px rail.
 * True inside the Field Capture iframe and on any viewport ≤ 640px.
 */
export function usePhoneShell(): boolean {
  const [phone, setPhone] = useState(() => isFieldEmbedMarked() || isPhoneShellViewport());

  useEffect(() => {
    function sync() {
      setPhone(isFieldEmbedMarked() || isPhoneShellViewport());
    }
    sync();
    const mq = window.matchMedia(PHONE_SHELL_MQ);
    mq.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return phone;
}
