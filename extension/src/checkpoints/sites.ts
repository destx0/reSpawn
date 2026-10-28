// Site mappings connect the same app across environments (production, staging,
// localhost). Bases are matched without the protocol, so `http://`, `https://`
// and scheme-less entries behave the same. A base may use `*` in the host or
// port: `*/app`, `*.abc.com/app`, `localhost:*/app`. A base without a port
// matches any port; an explicit port is exact.

export interface SiteEnvironment {
  readonly id: string;
  readonly name: string;
  /** Base URL, optionally with a `*` host/port wildcard. Scheme is ignored. */
  readonly baseUrl: string;
}

export interface SiteMapping {
  readonly id: string;
  readonly name: string;
  readonly environments: readonly SiteEnvironment[];
}

export interface ParsedSiteBase {
  readonly hostPattern: string;
  readonly portPattern: string;
  /** Normalized path prefix, always starts with `/`; `/` matches everything. */
  readonly path: string;
}

export interface SiteMatch {
  readonly mapping: SiteMapping;
  readonly environment: SiteEnvironment;
  /** Concrete base from the matched URL: origin + path prefix. */
  readonly baseUrl: string;
  /** Path after the base, plus search and hash. */
  readonly rest: string;
  /** Higher is more specific (exact host beats a wildcard, longer path wins). */
  readonly specificity: number;
}

export interface SiteMappingSuggestion {
  readonly id: string;
  readonly name: string;
  readonly environments: readonly SiteEnvironment[];
}

export const GLOBAL_APP_SUGGESTION: SiteMappingSuggestion = {
  id: 'suggestion-any-site-app',
  name: 'Any site /app',
  environments: [
    {
      id: 'suggestion-any-site-app-public',
      name: 'Any site',
      baseUrl: '*/app',
    },
    {
      id: 'suggestion-any-site-app-local',
      name: 'Local',
      baseUrl: 'localhost:4200',
    },
  ],
};

export function createSiteId(prefix = 'site'): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Parse a base URL without a protocol. `https://abc.com/app`, `abc.com/app`
 * and `//abc.com/app` all become `{ hostPattern: 'abc.com', path: '/app' }`.
 * Query strings and hashes are not part of a base.
 */
export function parseSiteBase(value: string): ParsedSiteBase | null {
  let raw = value.trim();
  if (!raw) return null;
  if (raw.startsWith('*://')) raw = raw.slice(4);
  else raw = raw.replace(SCHEME, '');
  if (raw.startsWith('//')) raw = raw.slice(2);
  if (/[?#]/.test(raw)) return null;

  const slash = raw.indexOf('/');
  const hostPort = slash === -1 ? raw : raw.slice(0, slash);
  const pathRaw = slash === -1 ? '/' : raw.slice(slash);
  if (!hostPort) return null;

  let host = hostPort;
  let port = '';
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']');
    if (end === -1) return null;
    host = hostPort.slice(0, end + 1);
    const after = hostPort.slice(end + 1);
    if (after) {
      if (!after.startsWith(':')) return null;
      port = after.slice(1);
    }
  } else {
    const colon = hostPort.lastIndexOf(':');
    if (colon !== -1) {
      host = hostPort.slice(0, colon);
      port = hostPort.slice(colon + 1);
    }
  }

  if (!host || host.includes('/')) return null;
  if (port && port !== '*' && !/^\d+$/.test(port)) return null;

  let path = pathRaw || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path.includes('*')) return null;

  return {
    hostPattern: host.toLowerCase(),
    portPattern: port === '*' ? '*' : port ? String(Number(port)) : '',
    path,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hostMatches(pattern: string, host: string): boolean {
  if (pattern === '*') return true;
  const source = pattern
    .split('*')
    .map((part) => escapeRegExp(part))
    .join('.*');
  return new RegExp(`^${source}$`, 'i').test(host);
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  if (url.protocol === 'https:') return '443';
  if (url.protocol === 'http:') return '80';
  return '';
}

function portMatches(pattern: string, url: URL): boolean {
  if (pattern === '*' || !pattern) return true;
  return pattern === effectivePort(url);
}

function normalizedPathname(pathname: string): string {
  if (!pathname) return '/';
  return pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
}

function pathMatches(basePath: string, pathname: string): boolean {
  if (basePath === '/') return true;
  const path = normalizedPathname(pathname);
  return path === basePath || path.startsWith(`${basePath}/`);
}

function hostSpecificity(pattern: string): number {
  if (pattern === '*') return 0;
  return pattern.includes('*') ? 1 : 2;
}

/**
 * Match `url` against a base. The returned `baseUrl` is concrete (the URL's
 * own origin and base path), which is what a translation should target.
 */
export function matchSiteBase(
  url: string,
  base: string,
): { baseUrl: string; rest: string; specificity: number } | null {
  const parsed = parseSiteBase(base);
  if (!parsed) return null;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (!hostMatches(parsed.hostPattern, target.hostname)) return null;
  if (!portMatches(parsed.portPattern, target)) return null;
  if (!pathMatches(parsed.path, target.pathname)) return null;

  const consumed = parsed.path === '/' ? 0 : parsed.path.length;
  let restPath = target.pathname.slice(consumed);
  if (!restPath.startsWith('/')) restPath = `/${restPath}`;
  const basePath = parsed.path === '/' ? '' : parsed.path;
  return {
    baseUrl: `${target.origin}${basePath}`,
    rest: `${restPath}${target.search}${target.hash}`,
    specificity:
      hostSpecificity(parsed.hostPattern) * 10_000 + parsed.path.length,
  };
}

/** Find the most specific environment matching `url`, if any. */
export function matchSite(
  url: string,
  mappings: readonly SiteMapping[],
): SiteMatch | null {
  let best: SiteMatch | null = null;
  for (const mapping of mappings) {
    for (const environment of mapping.environments) {
      const match = matchSiteBase(url, environment.baseUrl);
      if (!match) continue;
      if (best && best.specificity >= match.specificity) continue;
      best = { mapping, environment, ...match };
    }
  }
  return best;
}

function hostKey(url: string): string {
  try {
    const parsed = new URL(url);
    const port = parsed.port;
    return `${parsed.hostname.toLowerCase()}${port ? `:${port}` : ''}`;
  } catch {
    return url;
  }
}

/** Whether two URLs belong to the same environment group (or the same host). */
export function sameSite(
  a: string,
  b: string,
  mappings: readonly SiteMapping[],
): boolean {
  const aMatch = matchSite(a, mappings);
  const bMatch = matchSite(b, mappings);
  if (aMatch && bMatch) return aMatch.mapping.id === bMatch.mapping.id;
  if (aMatch || bMatch) return false;
  return hostKey(a) === hostKey(b);
}

export function routeForUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function joinBase(baseUrl: string, rest: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (rest === '/') return base;
  if (rest.startsWith('/?') || rest.startsWith('/#')) {
    return `${base}${rest.slice(1)}`;
  }
  const tail = rest.startsWith('/') ? rest : `/${rest}`;
  return `${base}${tail}`;
}

/**
 * Translate `url` into the environment of `targetUrl`. Returns `null` when the
 * two URLs are not in the same mapping group. The result keeps the target's
 * protocol and origin, and preserves the source's query and hash.
 */
export function translateUrl(
  url: string,
  targetUrl: string,
  mappings: readonly SiteMapping[],
): { url: string; route: string } | null {
  const source = matchSite(url, mappings);
  const target = matchSite(targetUrl, mappings);
  if (!source || !target || source.mapping.id !== target.mapping.id)
    return null;
  const translated = joinBase(target.baseUrl, source.rest);
  return { url: translated, route: routeForUrl(translated) };
}

function sameBase(a: string, b: string): boolean {
  const pa = parseSiteBase(a);
  const pb = parseSiteBase(b);
  if (!pa || !pb) return false;
  return (
    pa.hostPattern === pb.hostPattern &&
    pa.portPattern === pb.portPattern &&
    pa.path === pb.path
  );
}

function baseKey(base: string): string | null {
  const parsed = parseSiteBase(base);
  if (!parsed) return null;
  return `${parsed.hostPattern}|${parsed.portPattern}|${parsed.path}`;
}

/** Validate a draft before saving it. */
export function validateSiteMappings(
  mappings: readonly SiteMapping[],
): string[] {
  const errors: string[] = [];
  const bases = new Set<string>();
  for (const mapping of mappings) {
    const name = mapping.name.trim() || 'Untitled mapping';
    if (!mapping.name.trim()) errors.push('Every mapping needs a name.');
    if (mapping.environments.length < 2) {
      errors.push(`“${name}” needs at least two environments.`);
    }
    const names = new Set<string>();
    for (const environment of mapping.environments) {
      const envName = environment.name.trim() || 'Unnamed environment';
      if (!environment.name.trim()) {
        errors.push(`“${name}” has an environment without a name.`);
      }
      const key = baseKey(environment.baseUrl);
      if (!key) {
        errors.push(
          `“${environment.baseUrl || envName}” is not a valid base URL.`,
        );
        continue;
      }
      if (names.has(envName.toLocaleLowerCase())) {
        errors.push(`“${name}” has more than one “${envName}”.`);
      }
      names.add(envName.toLocaleLowerCase());
      if (bases.has(key)) {
        errors.push(`“${environment.baseUrl.trim()}” is used more than once.`);
      }
      bases.add(key);
    }
  }
  return [...new Set(errors)];
}

function suggestionExists(
  mappings: readonly SiteMapping[],
  suggestion: SiteMappingSuggestion,
): boolean {
  return mappings.some(
    (mapping) =>
      mapping.environments.length === suggestion.environments.length &&
      suggestion.environments.every((environment) =>
        mapping.environments.some((item) =>
          sameBase(item.baseUrl, environment.baseUrl),
        ),
      ),
  );
}

/**
 * Suggestions stay deliberately small: the global `/app` rule the user asked
 * for, plus a current-page rule when the inspected page is not localhost.
 */
export function suggestedSiteMappings(
  currentUrl: string | undefined,
  mappings: readonly SiteMapping[],
): SiteMappingSuggestion[] {
  const suggestions: SiteMappingSuggestion[] = [];
  if (!suggestionExists(mappings, GLOBAL_APP_SUGGESTION)) {
    suggestions.push(GLOBAL_APP_SUGGESTION);
  }
  if (!currentUrl) return suggestions;
  let url: URL;
  try {
    url = new URL(currentUrl);
  } catch {
    return suggestions;
  }
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(url.hostname)) {
    return suggestions;
  }
  const host = `${url.hostname}${url.port ? `:${url.port}` : ''}`;
  const current: SiteMappingSuggestion = {
    id: `suggestion-${host}`,
    name: url.hostname,
    environments: [
      {
        id: `suggestion-${host}-public`,
        name: 'Public',
        baseUrl: host,
      },
      {
        id: `suggestion-${host}-local`,
        name: 'Local',
        baseUrl: 'localhost:4200',
      },
    ],
  };
  if (!suggestionExists(mappings, current)) suggestions.push(current);
  return suggestions;
}

export function suggestionToMapping(
  suggestion: SiteMappingSuggestion,
): SiteMapping {
  return {
    id: createSiteId('mapping'),
    name: suggestion.name,
    environments: suggestion.environments.map((environment) => ({
      id: createSiteId('environment'),
      name: environment.name,
      baseUrl: environment.baseUrl,
    })),
  };
}
