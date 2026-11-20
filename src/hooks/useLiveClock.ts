import { useEffect, useState } from 'react';

/**
 * Returns a reactive current timestamp (ms) updated on a fixed interval.
 */
export function useLiveClock(intervalMs = 1000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return nowMs;
}
