import type { CheckpointExport, CheckpointMeta } from './core.js';

/**
 * Identifies the page a request targets. The panel passes the selected
 * DevTools instance key (`<tabId>/<id>` or `<tabId>-<frameId>/<id>`); the
 * content script passes nothing and is identified by its sender tab/frame.
 */
export interface CheckpointTarget {
  readonly instanceKey?: string | number;
  readonly tabId?: number;
}

/** Requests handled by the background (`chrome.runtime.sendMessage`). */
export type CheckpointRequest =
  | { readonly type: 'RESPAWN/LIST' }
  | ({ readonly type: 'RESPAWN/CONTEXT' } & CheckpointTarget)
  | ({
      readonly type: 'RESPAWN/SAVE';
      readonly name?: string;
    } & CheckpointTarget)
  | ({
      readonly type: 'RESPAWN/RESTORE';
      readonly id: string;
      /** Load the checkpoint's route first when the page has no connected store. */
      readonly open?: boolean;
    } & CheckpointTarget)
  | ({
      readonly type: 'RESPAWN/NAVIGATE';
      /** Absolute or relative (`./x`, `../x`) route. */
      readonly route: string;
    } & CheckpointTarget)
  | {
      readonly type: 'RESPAWN/RENAME';
      readonly id: string;
      readonly name: string;
    }
  | { readonly type: 'RESPAWN/DELETE'; readonly id: string }
  | { readonly type: 'RESPAWN/EXPORT'; readonly id: string }
  | {
      readonly type: 'RESPAWN/IMPORT';
      readonly data: unknown;
      readonly origin?: string;
    };

export interface PageContext {
  readonly url: string;
  readonly origin: string;
  readonly route: string;
}

export type CheckpointResponse<T = unknown> =
  ({ readonly ok: true } & T) | { readonly ok: false; readonly error: string };

export interface ResponseMap {
  'RESPAWN/LIST': { checkpoints: CheckpointMeta[] };
  'RESPAWN/CONTEXT': { context: PageContext; instanceName?: string };
  'RESPAWN/SAVE': { checkpoint: CheckpointMeta };
  'RESPAWN/RESTORE': { checkpoint: CheckpointMeta };
  'RESPAWN/NAVIGATE': { route: string };
  'RESPAWN/RENAME': { checkpoint: CheckpointMeta };
  'RESPAWN/DELETE': object;
  'RESPAWN/EXPORT': { record: CheckpointExport };
  'RESPAWN/IMPORT': { checkpoint: CheckpointMeta };
}

/** Requests the background sends to a content script (`chrome.tabs.sendMessage`). */
export type PageRequest =
  | { readonly type: 'RESPAWN/PAGE_CONTEXT' }
  | { readonly type: 'RESPAWN/PAGE_GO'; readonly route: string }
  | {
      readonly type: 'RESPAWN/PAGE_TOAST';
      readonly text: string;
      readonly kind: ToastKind;
    };

export type ToastKind = 'success' | 'info' | 'error';

export function isCheckpointRequest(
  message: unknown,
): message is CheckpointRequest {
  return (
    !!message &&
    typeof message === 'object' &&
    typeof (message as { type?: unknown }).type === 'string' &&
    (message as { type: string }).type.startsWith('RESPAWN/') &&
    !(message as { type: string }).type.startsWith('RESPAWN/PAGE_')
  );
}

/** Typed `chrome.runtime.sendMessage` wrapper for checkpoint requests. */
export async function requestCheckpoints<R extends CheckpointRequest>(
  request: R,
): Promise<CheckpointResponse<ResponseMap[R['type']]>> {
  try {
    const response = await chrome.runtime.sendMessage(request);
    return response ?? { ok: false, error: 'No response from reSpawn.' };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : 'reSpawn background is unavailable.',
    };
  }
}
