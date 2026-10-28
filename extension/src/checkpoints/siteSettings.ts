import { createSiteId, SiteEnvironment, SiteMapping } from './sites.js';

/** Saved with the extension settings so it follows the browser profile. */
export const SITE_MAPPINGS_KEY = 'respawn:siteMappings';

function normalizeEnvironment(value: unknown): SiteEnvironment | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.baseUrl !== 'string') return null;
  return {
    id:
      typeof item.id === 'string' && item.id
        ? item.id
        : createSiteId('environment'),
    name: typeof item.name === 'string' ? item.name : 'Environment',
    baseUrl: item.baseUrl,
  };
}

function normalizeMapping(value: unknown): SiteMapping | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.environments)) return null;
  const environments = item.environments
    .map(normalizeEnvironment)
    .filter((environment): environment is SiteEnvironment => !!environment);
  if (!environments.length) return null;
  return {
    id:
      typeof item.id === 'string' && item.id
        ? item.id
        : createSiteId('mapping'),
    name: typeof item.name === 'string' ? item.name : 'Site mapping',
    environments,
  };
}

export function normalizeSiteMappings(value: unknown): SiteMapping[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeMapping)
    .filter((mapping): mapping is SiteMapping => !!mapping);
}

export async function readSiteMappings(): Promise<SiteMapping[]> {
  try {
    const result = await chrome.storage.sync.get(SITE_MAPPINGS_KEY);
    return normalizeSiteMappings(result[SITE_MAPPINGS_KEY]);
  } catch {
    return [];
  }
}

export async function writeSiteMappings(
  mappings: readonly SiteMapping[],
): Promise<void> {
  await chrome.storage.sync.set({ [SITE_MAPPINGS_KEY]: mappings });
}
