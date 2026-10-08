// Pure checkpoint helpers shared by the background, content script and panel.
// Ported from inspector-ng (`checkpoints.ts` / `checkpoint-search.ts`).

/** Metadata kept in the index; cheap to list. */
export interface CheckpointMeta {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  /** `location.origin` of the page the checkpoint was saved on. */
  readonly origin: string;
  /** `pathname + search + hash`, used for in-app navigation. */
  readonly route: string;
  readonly url: string;
  readonly instanceName?: string;
  readonly createdAt: string;
  readonly lastUsedAt?: string;
  /** Size of the serialized state in characters. */
  readonly size: number;
}

/** A full checkpoint, as stored and exported. */
export interface CheckpointRecord extends CheckpointMeta {
  /** Whether `state` was serialized with the instance's `serialize` option. */
  readonly serialize: boolean;
  /** The app state, serialized with jsan (`stringifyJSON`). */
  readonly state: string;
}

export const ROUTE_PREFIXES = ['/', './', '../'] as const;

export function isRouteQuery(query: string): boolean {
  const raw = query.trim();
  return (
    raw === '.' ||
    raw === '..' ||
    ROUTE_PREFIXES.some((prefix) => raw.startsWith(prefix))
  );
}

/**
 * Resolve `/abs`, `./child` or `../sibling` against the current pathname.
 * The current route is treated as a directory, like Angular's relative
 * navigation: on `/workflow`, `./detail` is `/workflow/detail` and `../x` is `/x`.
 */
export function resolveRouteQuery(
  query: string,
  basePathname: string,
): string | null {
  const raw = query.trim();
  if (!raw) return null;
  if (raw.startsWith('/')) return raw;
  if (!isRouteQuery(raw)) return null;
  const base = basePathname.startsWith('/') ? basePathname : `/${basePathname}`;
  const directory = base.endsWith('/') ? base : `${base}/`;
  const url = new URL(raw, `http://respawn.local${directory}`);
  const pathname =
    url.pathname.length > 1 && url.pathname.endsWith('/')
      ? url.pathname.slice(0, -1)
      : url.pathname;
  return `${pathname}${url.search}${url.hash}`;
}

/**
 * Resolve a route query for a page URL, returning `pathname + search + hash`.
 * Hash-routed apps (`#/route`, `#!/route`) resolve inside the hash.
 */
export function resolveRouteForUrl(
  query: string,
  pageUrl: string,
): string | null {
  const url = new URL(pageUrl);
  const hashRouter = /^#!?(?=\/)/.exec(url.hash);
  if (hashRouter) {
    const prefix = hashRouter[0];
    const hashPathname = new URL(
      url.hash.slice(prefix.length),
      'http://respawn.local',
    ).pathname;
    const resolved = resolveRouteQuery(query, hashPathname);
    return resolved && `${url.pathname}${url.search}${prefix}${resolved}`;
  }
  return resolveRouteQuery(query, url.pathname);
}

export function nextAutomaticName(base: string, names: string[]): string {
  const used = new Set(names.map((name) => name.toLocaleLowerCase()));
  if (!used.has(base.toLocaleLowerCase())) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

export function checkpointActivityAt(checkpoint: CheckpointMeta): string {
  return checkpoint.lastUsedAt && checkpoint.lastUsedAt > checkpoint.createdAt
    ? checkpoint.lastUsedAt
    : checkpoint.createdAt;
}

export function recentActivityFirst(a: CheckpointMeta, b: CheckpointMeta) {
  return (
    checkpointActivityAt(b).localeCompare(checkpointActivityAt(a)) ||
    b.createdAt.localeCompare(a.createdAt) ||
    b.id.localeCompare(a.id)
  );
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();
}

/** Exact 10k, prefix 8k, substring 6k, subsequence 4k (with gap penalty). */
export function fuzzyScore(
  value: string,
  normalizedQuery: string,
): number | null {
  const candidate = normalize(value);
  if (candidate === normalizedQuery) return 10_000;
  if (candidate.startsWith(normalizedQuery)) return 8_000 - candidate.length;

  const substringIndex = candidate.indexOf(normalizedQuery);
  if (substringIndex >= 0) {
    return 6_000 - substringIndex * 10 - candidate.length;
  }

  let queryIndex = 0;
  let firstIndex = -1;
  let lastIndex = -1;
  let gapPenalty = 0;
  for (
    let index = 0;
    index < candidate.length && queryIndex < normalizedQuery.length;
    index += 1
  ) {
    if (candidate[index] !== normalizedQuery[queryIndex]) continue;
    if (firstIndex < 0) firstIndex = index;
    if (lastIndex >= 0) gapPenalty += index - lastIndex - 1;
    lastIndex = index;
    queryIndex += 1;
  }
  if (queryIndex !== normalizedQuery.length) return null;
  return 4_000 - firstIndex * 10 - gapPenalty * 20 - candidate.length;
}

/** Rank by the best of name and route; empty query keeps recent-first order. */
export function fuzzyCheckpoints<T extends CheckpointMeta>(
  checkpoints: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) return [...checkpoints].sort(recentActivityFirst);

  return checkpoints
    .map((checkpoint) => {
      const nameScore = fuzzyScore(checkpoint.name, normalizedQuery);
      const routeScore = fuzzyScore(checkpoint.route, normalizedQuery);
      const score =
        nameScore === null && routeScore === null
          ? null
          : Math.max(nameScore ?? -Infinity, (routeScore ?? -Infinity) - 1);
      return { checkpoint, score };
    })
    .filter(
      (item): item is { checkpoint: T; score: number } => item.score !== null,
    )
    .sort(
      (a, b) =>
        b.score - a.score || recentActivityFirst(a.checkpoint, b.checkpoint),
    )
    .map(({ checkpoint }) => checkpoint);
}

/** Compact relative time: now, 1m, 5m, 2h, 3d, 4mo, 1y. */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return 'now';
  if (seconds < 90) return '1m';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(months / 12)}y`;
}

export function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / 1024 / 1024).toFixed(1)} MB`;
}

export function toMeta(record: CheckpointRecord): CheckpointMeta {
  const { state, serialize, ...meta } = record;
  return meta;
}

export function createCheckpointId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `checkpoint-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * Validate an imported file. Accepts reSpawn exports and inspector-ng
 * version 1 exports (`state` as a plain object, no origin/url).
 * `stringify` serializes a raw state object.
 */
export function normalizeImportedCheckpoint(
  value: unknown,
  stringify: (state: unknown) => string,
  fallbackOrigin: string,
): CheckpointRecord | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    v.version !== 1 ||
    typeof v.name !== 'string' ||
    typeof v.route !== 'string' ||
    !('state' in v)
  ) {
    return null;
  }
  const isRespawn = typeof v.state === 'string' && typeof v.origin === 'string';
  const state = isRespawn ? (v.state as string) : stringify(v.state);
  const url = typeof v.url === 'string' ? v.url : '';
  const origin =
    (typeof v.origin === 'string' && v.origin) ||
    originOf(url) ||
    fallbackOrigin;
  return {
    version: 1,
    id: createCheckpointId(),
    name: v.name,
    origin,
    route: v.route,
    url: url || `${origin}${v.route}`,
    instanceName:
      typeof v.instanceName === 'string' ? v.instanceName : undefined,
    createdAt: new Date().toISOString(),
    size: state.length,
    serialize: isRespawn ? v.serialize === true : false,
    state,
  };
}
