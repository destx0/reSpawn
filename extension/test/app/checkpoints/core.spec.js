import {
  formatRelativeTime,
  fuzzyCheckpoints,
  isRouteQuery,
  nextAutomaticName,
  normalizeImportedCheckpoint,
  toCheckpointExport,
  recentActivityFirst,
  resolveRouteForUrl,
  resolveRouteQuery,
} from '../../../src/checkpoints/core.js';

function meta(overrides) {
  return {
    version: 1,
    id: 'id',
    name: 'name',
    origin: 'http://localhost:4200',
    route: '/',
    url: 'http://localhost:4200/',
    createdAt: '2026-01-01T00:00:00.000Z',
    size: 2,
    ...overrides,
  };
}

describe('resolveRouteQuery', () => {
  it('keeps absolute routes', () => {
    expect(resolveRouteQuery('/summary?x=1#top', '/workflow')).toBe(
      '/summary?x=1#top',
    );
  });

  it('treats the current route as a directory', () => {
    expect(resolveRouteQuery('./detail', '/workflow')).toBe('/workflow/detail');
    expect(resolveRouteQuery('./detail', '/workflow/')).toBe(
      '/workflow/detail',
    );
    expect(resolveRouteQuery('../next', '/workflow/step')).toBe(
      '/workflow/next',
    );
    expect(resolveRouteQuery('../', '/workflow/step')).toBe('/workflow');
    expect(resolveRouteQuery('..', '/workflow')).toBe('/');
    expect(resolveRouteQuery('.', '/workflow')).toBe('/workflow');
  });

  it('does not duplicate the current segment (/workflow/workflow)', () => {
    expect(resolveRouteQuery('../workflow', '/workflow')).toBe('/workflow');
  });

  it('rejects non-route text', () => {
    expect(resolveRouteQuery('detail', '/workflow')).toBeNull();
    expect(resolveRouteQuery('   ', '/workflow')).toBeNull();
    expect(isRouteQuery('checkout')).toBe(false);
    expect(isRouteQuery(' ./x')).toBe(true);
  });
});

describe('resolveRouteForUrl', () => {
  it('resolves against the pathname for history routers', () => {
    expect(
      resolveRouteForUrl('./b', 'http://localhost:4200/app/a?q=1#frag'),
    ).toBe('/app/a/b');
  });

  it('resolves inside the hash for hash routers', () => {
    expect(
      resolveRouteForUrl('./detail', 'http://x.test/index.html#/list'),
    ).toBe('/index.html#/list/detail');
    expect(resolveRouteForUrl('/home', 'http://x.test/#!/list')).toBe(
      '/#!/home',
    );
  });
});

describe('nextAutomaticName', () => {
  it('suffixes duplicates case-insensitively', () => {
    expect(nextAutomaticName('/cart', [])).toBe('/cart');
    expect(nextAutomaticName('/cart', ['/CART'])).toBe('/cart 2');
    expect(nextAutomaticName('/cart', ['/cart', '/cart 2'])).toBe('/cart 3');
  });
});

describe('ordering and search', () => {
  const older = meta({ id: 'a', name: 'checkout', route: '/checkout' });
  const newer = meta({
    id: 'b',
    name: 'cart empty',
    route: '/cart',
    createdAt: '2026-02-01T00:00:00.000Z',
  });
  const usedRecently = meta({
    id: 'c',
    name: 'profile',
    route: '/me',
    lastUsedAt: '2026-03-01T00:00:00.000Z',
  });

  it('sorts by last activity first', () => {
    expect(
      [older, newer, usedRecently].sort(recentActivityFirst).map((c) => c.id),
    ).toEqual(['c', 'b', 'a']);
  });

  it('ranks prefix over subsequence and matches routes', () => {
    expect(fuzzyCheckpoints([older, newer], 'cart').map((c) => c.id)).toEqual([
      'b',
    ]);
    expect(fuzzyCheckpoints([older, newer], 'chk').map((c) => c.id)).toEqual([
      'a',
    ]);
    expect(
      fuzzyCheckpoints([older, newer, usedRecently], '/me').map((c) => c.id),
    ).toEqual(['c']);
  });
});

describe('normalizeImportedCheckpoint', () => {
  const stringify = (value) => JSON.stringify(value);

  it('accepts inspector-ng v1 exports (plain state, no origin)', () => {
    const record = normalizeImportedCheckpoint(
      {
        version: 1,
        id: 'old',
        name: '/workflow',
        route: '/workflow',
        createdAt: '2025-01-01T00:00:00.000Z',
        state: { counter: 3 },
      },
      stringify,
      'http://localhost:4200',
    );
    expect(record).toMatchObject({
      name: '/workflow',
      origin: 'http://localhost:4200',
      url: 'http://localhost:4200/workflow',
      serialize: false,
      state: '{"counter":3}',
    });
    expect(record?.id).not.toBe('old');
  });

  it('round-trips an export with state as a JSON object', () => {
    const stored = {
      version: 1,
      id: 'x',
      name: 'n',
      origin: 'https://app.test',
      route: '/a',
      url: 'https://app.test/a',
      createdAt: '2026-01-01T00:00:00.000Z',
      size: 33,
      serialize: false,
      state: '{"a":{"b":1},"c":{"$jsan":"$.a"}}',
    };
    const exported = toCheckpointExport(stored);
    expect(exported.state).toEqual({ a: { b: 1 }, c: { $jsan: '$.a' } });
    const record = normalizeImportedCheckpoint(
      JSON.parse(JSON.stringify(exported)),
      stringify,
      'http://other.test',
    );
    expect(record).toMatchObject({
      origin: 'https://app.test',
      state: stored.state,
    });
  });

  it('rejects other files', () => {
    expect(normalizeImportedCheckpoint({ foo: 1 }, stringify, '')).toBeNull();
    expect(normalizeImportedCheckpoint(null, stringify, '')).toBeNull();
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-01-10T00:00:00.000Z');
  it('is compact', () => {
    expect(formatRelativeTime('2026-01-10T00:00:00.000Z', now)).toBe('now');
    expect(formatRelativeTime('2026-01-09T23:55:00.000Z', now)).toBe('5m');
    expect(formatRelativeTime('2026-01-09T22:00:00.000Z', now)).toBe('2h');
    expect(formatRelativeTime('2026-01-07T00:00:00.000Z', now)).toBe('3d');
    expect(formatRelativeTime('bad', now)).toBe('');
  });
});
