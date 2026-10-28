import {
  GLOBAL_APP_SUGGESTION,
  matchSite,
  matchSiteBase,
  parseSiteBase,
  sameSite,
  suggestedSiteMappings,
  suggestionToMapping,
  translateUrl,
  validateSiteMappings,
} from '../../../src/checkpoints/sites.js';

function environment(id, name, baseUrl) {
  return { id, name, baseUrl };
}

function mapping(id, environments) {
  return { id, name: id, environments };
}

const app = mapping('app', [
  environment('prod', 'Production', 'https://abc.com/app'),
  environment('local', 'Local', 'http://localhost:4200'),
  environment('staging', 'Staging', 'https://staging.abc.com/app'),
]);

const anyApp = mapping('any-app', [
  environment('any', 'Any site', '*/app'),
  environment('local', 'Local', 'localhost:4200'),
]);

describe('parseSiteBase', () => {
  it('ignores the protocol and keeps the path prefix', () => {
    expect(parseSiteBase('https://abc.com/app')).toEqual({
      hostPattern: 'abc.com',
      portPattern: '',
      path: '/app',
    });
    expect(parseSiteBase('abc.com/app')).toEqual(
      parseSiteBase('http://abc.com/app'),
    );
    expect(parseSiteBase('//abc.com/app')).toEqual(
      parseSiteBase('https://abc.com/app'),
    );
  });

  it('accepts host and port wildcards', () => {
    expect(parseSiteBase('*/app')).toMatchObject({
      hostPattern: '*',
      path: '/app',
    });
    expect(parseSiteBase('*.abc.com/app')).toMatchObject({
      hostPattern: '*.abc.com',
      path: '/app',
    });
    expect(parseSiteBase('localhost:*/app')).toMatchObject({
      hostPattern: 'localhost',
      portPattern: '*',
      path: '/app',
    });
  });

  it('rejects query strings, hashes and path wildcards', () => {
    expect(parseSiteBase('abc.com/app?x=1')).toBeNull();
    expect(parseSiteBase('abc.com/app#top')).toBeNull();
    expect(parseSiteBase('abc.com/app/*')).toBeNull();
    expect(parseSiteBase('')).toBeNull();
  });
});

describe('matchSiteBase', () => {
  it('matches whole path segments', () => {
    expect(
      matchSiteBase('https://abc.com/app/orders', 'abc.com/app'),
    ).toMatchObject({
      baseUrl: 'https://abc.com/app',
      rest: '/orders',
    });
    expect(
      matchSiteBase('https://abc.com/application', 'abc.com/app'),
    ).toBeNull();
  });

  it('ignores http versus https', () => {
    expect(
      matchSiteBase('http://abc.com/app', 'https://abc.com/app'),
    ).not.toBeNull();
    expect(
      matchSiteBase('https://abc.com/app', 'http://abc.com/app'),
    ).not.toBeNull();
  });

  it('supports wildcard hosts and ports', () => {
    expect(
      matchSiteBase('https://foo.abc.com/app', '*.abc.com/app'),
    ).not.toBeNull();
    expect(matchSiteBase('https://abc.com/app', '*.abc.com/app')).toBeNull();
    expect(matchSiteBase('https://foo.com/app', '*/app')).not.toBeNull();
    expect(
      matchSiteBase('http://localhost:4200/app', 'localhost:*/app'),
    ).not.toBeNull();
    expect(
      matchSiteBase('http://localhost:3000/app', 'localhost:4200/app'),
    ).toBeNull();
    expect(
      matchSiteBase('http://localhost:3000/app', 'localhost/app'),
    ).not.toBeNull();
  });
});

describe('sameSite', () => {
  it('treats mapped environments as the same site', () => {
    expect(
      sameSite('https://abc.com/app/orders', 'http://localhost:4200/cart', [
        app,
      ]),
    ).toBe(true);
    expect(
      sameSite('https://staging.abc.com/app/orders', 'http://localhost:4200/', [
        app,
      ]),
    ).toBe(true);
  });

  it('groups every host matched by a global wildcard', () => {
    expect(
      sameSite('https://foo.com/app/a', 'https://bar.com/app/b', [anyApp]),
    ).toBe(true);
    expect(
      sameSite('https://foo.com/app/a', 'http://localhost:4200/b', [anyApp]),
    ).toBe(true);
  });

  it('ignores the protocol for unmapped hosts but keeps ports', () => {
    expect(sameSite('http://abc.com/a', 'https://abc.com/b', [])).toBe(true);
    expect(
      sameSite('http://localhost:4200/a', 'https://localhost:4200/b', []),
    ).toBe(true);
    expect(
      sameSite('http://localhost:4200/a', 'http://localhost:3000/b', []),
    ).toBe(false);
  });
});

describe('translateUrl', () => {
  it('strips the public base path on the way to localhost', () => {
    expect(
      translateUrl(
        'https://abc.com/app/orders/42?tab=items#top',
        'http://localhost:4200/cart',
        [app],
      ),
    ).toEqual({
      url: 'http://localhost:4200/orders/42?tab=items#top',
      route: '/orders/42?tab=items#top',
    });
  });

  it('adds the public base path on the way back', () => {
    expect(
      translateUrl(
        'http://localhost:4200/orders/42?tab=items#top',
        'https://abc.com/app',
        [app],
      ),
    ).toEqual({
      url: 'https://abc.com/app/orders/42?tab=items#top',
      route: '/app/orders/42?tab=items#top',
    });
  });

  it('translates between any two environments in the group', () => {
    expect(
      translateUrl(
        'https://staging.abc.com/app/orders',
        'http://localhost:4200/',
        [app],
      )?.url,
    ).toBe('http://localhost:4200/orders');
  });

  it('keeps the base URL clean for the root route', () => {
    expect(
      translateUrl('http://localhost:4200/', 'https://abc.com/app', [app])?.url,
    ).toBe('https://abc.com/app');
  });

  it('supports a global wildcard', () => {
    expect(
      translateUrl('https://foo.com/app/orders', 'http://localhost:4200/home', [
        anyApp,
      ])?.url,
    ).toBe('http://localhost:4200/orders');
    expect(
      translateUrl('http://localhost:4200/orders', 'https://foo.com/app/home', [
        anyApp,
      ])?.url,
    ).toBe('https://foo.com/app/orders');
  });

  it('returns null for unrelated sites', () => {
    expect(
      translateUrl('https://other.com/app/orders', 'http://localhost:4200/', [
        app,
      ]),
    ).toBeNull();
    expect(
      translateUrl('http://localhost:4200/orders', 'https://other.com/app', [
        app,
      ]),
    ).toBeNull();
  });
});

describe('validateSiteMappings', () => {
  it('accepts a complete mapping', () => {
    expect(validateSiteMappings([app])).toEqual([]);
  });

  it('requires at least two environments', () => {
    expect(
      validateSiteMappings([
        mapping('one', [environment('local', 'Local', 'localhost:4200')]),
      ]),
    ).toContain('“one” needs at least two environments.');
  });

  it('rejects duplicate and invalid bases', () => {
    const duplicate = mapping('duplicate', [
      environment('a', 'A', 'abc.com/app'),
      environment('b', 'B', 'https://abc.com/app'),
    ]);
    const invalid = mapping('invalid', [
      environment('a', 'A', 'abc.com/app?x=1'),
      environment('b', 'B', 'localhost:4200'),
    ]);
    expect(validateSiteMappings([duplicate])).toContain(
      '“https://abc.com/app” is used more than once.',
    );
    expect(validateSiteMappings([invalid])).toContain(
      '“abc.com/app?x=1” is not a valid base URL.',
    );
  });
});

describe('suggestedSiteMappings', () => {
  it('suggests the global /app rule', () => {
    expect(suggestedSiteMappings(undefined, [])).toEqual([
      GLOBAL_APP_SUGGESTION,
    ]);
    expect(
      suggestedSiteMappings(undefined, [
        suggestionToMapping(GLOBAL_APP_SUGGESTION),
      ]),
    ).toEqual([]);
  });

  it('suggests the current public host and localhost', () => {
    const suggestions = suggestedSiteMappings('https://abc.com/app/orders', []);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[1]).toMatchObject({
      name: 'abc.com',
      environments: [
        { name: 'Public', baseUrl: 'abc.com' },
        { name: 'Local', baseUrl: 'localhost:4200' },
      ],
    });
  });

  it('does not suggest the current page on localhost', () => {
    expect(suggestedSiteMappings('http://localhost:4200/orders', [])).toEqual([
      GLOBAL_APP_SUGGESTION,
    ]);
  });
});

describe('matchSite', () => {
  it('prefers an exact host over a wildcard', () => {
    const exact = mapping('exact', [
      environment('prod', 'Production', 'https://abc.com/app'),
      environment('local', 'Local', 'http://localhost:4200'),
    ]);
    const found = matchSite('https://abc.com/app/orders', [anyApp, exact]);
    expect(found?.mapping.id).toBe('exact');
  });
});
