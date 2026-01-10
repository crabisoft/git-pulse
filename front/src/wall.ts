import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * The key that turns a page into a wall screen. In the address rather than in
 * a stored preference: it describes the screen, not the person. The monitor in
 * the corner is opened once on a link and forgotten, while the same account on
 * a laptop keeps reading the ordinary page.
 */
export const WALL_PARAM = 'wall';

/**
 * A screen nobody is standing at.
 *
 * Stamps the state on the root element so the stylesheet can enlarge the type
 * and drop the chrome, and asks the browser to keep the display awake — a
 * dashboard that goes black after ten minutes is not a dashboard.
 *
 * The wake lock is best effort by nature: it is refused on an unfocused
 * document, unimplemented on some browsers, and dropped whenever the tab is
 * hidden. Re-requested on the way back rather than treated as an error, since
 * losing it costs a dark screen and nothing else.
 */
export function useWallMode(): boolean {
  const [searchParams] = useSearchParams();
  const wall = searchParams.has(WALL_PARAM);

  useEffect(() => {
    if (!wall) {
      delete document.documentElement.dataset.wall;
      return;
    }
    document.documentElement.dataset.wall = 'on';

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      if (released || document.hidden || !navigator.wakeLock) return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Refused — an unfocused document, a policy, a browser without it.
      }
    };
    const onVisibility = () => {
      if (!document.hidden) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => {});
      delete document.documentElement.dataset.wall;
    };
  }, [wall]);

  return wall;
}

/** The same address, read at a desk again. */
export function withoutWall(searchParams: URLSearchParams): string {
  const params = new URLSearchParams(searchParams);
  params.delete(WALL_PARAM);
  return params.toString();
}
