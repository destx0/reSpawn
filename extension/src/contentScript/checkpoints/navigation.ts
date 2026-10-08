export interface GoResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly url?: string;
}

/**
 * Navigate inside a single-page app without reloading.
 *
 * `pushState` + a synthetic `popstate` is what Angular's Location, React
 * Router, Vue Router and most history-based routers listen to, so the app's
 * router handles the change exactly like a browser back/forward. Hash-only
 * changes go through `location.hash`, which fires `hashchange` natively.
 */
export async function goToRoute(route: string): Promise<GoResult> {
  let target: URL;
  try {
    target = new URL(route, location.href);
  } catch {
    return { ok: false, error: `“${route}” is not a valid route.` };
  }
  if (target.origin !== location.origin) {
    return {
      ok: false,
      error: `${target.origin} is a different origin than this page.`,
    };
  }

  const next = `${target.pathname}${target.search}${target.hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (next === current) return { ok: true, url: location.href };

  if (
    target.pathname === location.pathname &&
    target.search === location.search
  ) {
    location.hash = target.hash;
  } else {
    history.pushState(null, '', next);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  }
  // Give the router a tick to pick up the change.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { ok: true, url: location.href };
}
