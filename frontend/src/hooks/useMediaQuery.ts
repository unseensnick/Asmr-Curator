import { useSyncExternalStore } from "react";

// useSyncExternalStore lets React subscribe to a browser API (MediaQueryList)
// without the double-mount / stale-snapshot bugs that a useState + useEffect
// implementation has. The empty-server-snapshot returns false so a future SSR
// pass doesn't crash on `window` access; for this client-only app it's just
// hygiene.
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (notify) => {
            const mql = window.matchMedia(query);
            mql.addEventListener("change", notify);
            return () => mql.removeEventListener("change", notify);
        },
        () => window.matchMedia(query).matches,
        () => false,
    );
}
