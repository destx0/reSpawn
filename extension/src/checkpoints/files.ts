// Browser-side helpers shared by the panel and the in-page palette.
import type { CheckpointExport, CheckpointMeta } from './core.js';

/** Whether checkpoints from every site are listed (panel and palette share it). */
export const ALL_SITES_KEY = 'respawn:checkpoints:allSites';

export async function readAllSites(): Promise<boolean> {
  const result = await chrome.storage.local.get(ALL_SITES_KEY);
  return result[ALL_SITES_KEY] === true;
}

export function writeAllSites(value: boolean) {
  return chrome.storage.local.set({ [ALL_SITES_KEY]: value });
}

function fileNameFor(checkpoint: CheckpointMeta) {
  const slug = checkpoint.name
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `respawn-${slug || 'checkpoint'}.json`;
}

export function downloadCheckpoint(record: CheckpointExport) {
  const blob = new Blob([JSON.stringify(record, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileNameFor(record);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parse a checkpoint file; throws a readable message for invalid JSON. */
export async function readCheckpointFile(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${file.name} is not valid JSON.`);
  }
}
