import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AskSeekTarget } from './askSeek';

type VideoSeekContextValue = {
  request: AskSeekTarget | null;
  seek: (target: AskSeekTarget) => void;
};

const VideoSeekContext = createContext<VideoSeekContextValue>({
  request: null,
  seek: () => undefined,
});

export function VideoSeekProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<AskSeekTarget | null>(null);
  const seek = useCallback((target: AskSeekTarget) => {
    setRequest({ ...target });
  }, []);
  const value = useMemo(() => ({ request, seek }), [request, seek]);
  return <VideoSeekContext.Provider value={value}>{children}</VideoSeekContext.Provider>;
}

export function useVideoSeek(): VideoSeekContextValue {
  return useContext(VideoSeekContext);
}
