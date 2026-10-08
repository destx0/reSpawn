import jsan from 'jsan';
import { stringifyJSON } from '@redux-devtools/app';
import type { State } from '@redux-devtools/app';
import { store } from './index.js';
import {
  getTabConnectionIds,
  hasMonitors,
  postToTab,
  waitForInstanceUpdate,
} from './store/apiMiddleware.js';
import {
  CheckpointMeta,
  CheckpointRecord,
  createCheckpointId,
  nextAutomaticName,
  normalizeImportedCheckpoint,
  recentActivityFirst,
  resolveRouteForUrl,
  toMeta,
} from '../checkpoints/core.js';
import {
  CheckpointRequest,
  CheckpointResponse,
  CheckpointTarget,
  isCheckpointRequest,
  PageContext,
  PageRequest,
  ResponseMap,
  ToastKind,
} from '../checkpoints/messages.js';

const INDEX_KEY = 'respawn:checkpoints:index';
const stateKey = (id: string) => `respawn:checkpoints:state:${id}`;

/** Wait after navigation before re-applying state (guards/resolvers may reset it). */
const RESTORE_SETTLE_DELAY_MS = 150;
/** How long to wait for an app to report its state after `START`. */
const START_TIMEOUT_MS = 1500;
/** How long to wait for a fresh state after `UPDATE` while monitored. */
const UPDATE_TIMEOUT_MS = 300;

export const CHECKPOINT_INDEX_KEY = INDEX_KEY;

class CheckpointError extends Error {}

interface StoredState {
  readonly serialize: boolean;
  readonly state: string;
}

// ---------------------------------------------------------------------------
// Storage (chrome.storage.local). All writes go through one queue so
// concurrent requests (hotkey + panel) never clobber the index.

let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function readIndex(): Promise<CheckpointMeta[]> {
  const result = await chrome.storage.local.get(INDEX_KEY);
  const index = result[INDEX_KEY] as CheckpointMeta[] | undefined;
  return Array.isArray(index) ? index : [];
}

async function writeIndex(index: CheckpointMeta[]) {
  await chrome.storage.local.set({
    [INDEX_KEY]: [...index].sort(recentActivityFirst),
  });
}

async function readRecord(id: string): Promise<CheckpointRecord> {
  const meta = (await readIndex()).find((item) => item.id === id);
  if (!meta) {
    throw new CheckpointError(
      'Checkpoint not found. It may have been deleted in another window.',
    );
  }
  const result = await chrome.storage.local.get(stateKey(id));
  const stored = result[stateKey(id)] as StoredState | undefined;
  if (!stored || typeof stored.state !== 'string') {
    throw new CheckpointError(
      `“${meta.name}” has no stored state. Delete it and save a new checkpoint.`,
    );
  }
  return { ...meta, serialize: stored.serialize, state: stored.state };
}

function putRecord(record: CheckpointRecord) {
  return exclusive(async () => {
    const index = await readIndex();
    const meta = toMeta(record);
    try {
      await chrome.storage.local.set({
        [stateKey(record.id)]: {
          serialize: record.serialize,
          state: record.state,
        } satisfies StoredState,
      });
    } catch (error) {
      throw storageError(error, 'The checkpoint could not be saved.');
    }
    await writeIndex([meta, ...index.filter((item) => item.id !== record.id)]);
    return meta;
  });
}

function updateMeta(
  id: string,
  update: (meta: CheckpointMeta, index: CheckpointMeta[]) => CheckpointMeta,
) {
  return exclusive(async () => {
    const index = await readIndex();
    const meta = index.find((item) => item.id === id);
    if (!meta) {
      throw new CheckpointError(
        'Checkpoint not found. It may have been deleted in another window.',
      );
    }
    const next = update(meta, index);
    await writeIndex(index.map((item) => (item.id === id ? next : item)));
    return next;
  });
}

function deleteRecord(id: string) {
  return exclusive(async () => {
    const index = await readIndex();
    await chrome.storage.local.remove(stateKey(id));
    await writeIndex(index.filter((item) => item.id !== id));
  });
}

function storageError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  if (/quota/i.test(message)) {
    return new CheckpointError(
      'Extension storage is full. Delete old checkpoints, then try again.',
    );
  }
  return new CheckpointError(message || fallback);
}

// ---------------------------------------------------------------------------
// Targets: which tab/frame/DevTools instance a request is about.

interface ResolvedTarget {
  readonly tabId: number;
  readonly frameId: number;
  /** Tab connection id: `<tabId>` or `<tabId>-<frameId>`. */
  readonly connectionId: string;
  /** Explicit DevTools instance key (from the panel), if any. */
  readonly instanceKey?: string;
}

function resolveTarget(
  request: CheckpointTarget,
  sender: chrome.runtime.MessageSender,
): ResolvedTarget {
  if (request.instanceKey !== undefined && request.instanceKey !== null) {
    const instanceKey = String(request.instanceKey);
    const connectionId = instanceKey.split('/')[0];
    const match = /^(\d+)(?:-(\d+))?$/.exec(connectionId);
    if (!match) {
      throw new CheckpointError(
        'Checkpoints only work for stores running in a browser tab.',
      );
    }
    return {
      tabId: Number(match[1]),
      frameId: match[2] ? Number(match[2]) : 0,
      connectionId,
      instanceKey,
    };
  }

  const tabId = request.tabId ?? sender.tab?.id;
  if (tabId === undefined) {
    throw new CheckpointError('No page selected.');
  }
  const frameId = request.tabId === undefined ? (sender.frameId ?? 0) : 0;
  const own = frameId ? `${tabId}-${frameId}` : `${tabId}`;
  const ids = getTabConnectionIds();
  // The store may live in another frame than the one the hotkey came from.
  const connectionId = ids.includes(own)
    ? own
    : (ids.find((id) => id === `${tabId}` || id.startsWith(`${tabId}-`)) ??
      own);
  const frame = /^\d+-(\d+)$/.exec(connectionId);
  return {
    tabId,
    frameId: frame ? Number(frame[1]) : 0,
    connectionId,
  };
}

function pickInstance(
  target: ResolvedTarget,
  preferredName?: string,
): string | undefined {
  const { connections, options, states, selected, current } =
    store.getState().instances;
  const keys = (connections[target.connectionId] ?? [])
    .map(String)
    .filter((key) => states[key]);
  if (target.instanceKey && keys.includes(target.instanceKey)) {
    return target.instanceKey;
  }
  if (preferredName !== undefined) {
    const byName = keys.find((key) => options[key]?.name === preferredName);
    if (byName) return byName;
  }
  if (selected !== null && keys.includes(String(selected))) {
    return String(selected);
  }
  if (keys.includes(String(current))) return String(current);
  return keys[0];
}

/**
 * Make sure the background holds a fresh state for the target.
 * Without an open DevTools panel apps don't report state (NgRx also ignores
 * monitor actions), so we send `START` and remember to `STOP` afterwards.
 */
async function wake(target: ResolvedTarget): Promise<() => void> {
  const started = !hasMonitors();
  const posted = postToTab(
    target.connectionId,
    started ? { type: 'START' } : { type: 'UPDATE' },
  );
  if (!posted) {
    throw new CheckpointError(
      'No Redux DevTools store is connected on this page.',
    );
  }
  await waitForInstanceUpdate(
    target.connectionId,
    started ? START_TIMEOUT_MS : UPDATE_TIMEOUT_MS,
  );
  return () => {
    if (started && !hasMonitors()) {
      postToTab(target.connectionId, { type: 'STOP' });
    }
  };
}

// ---------------------------------------------------------------------------
// Page (content script) helpers.

function sendToPage<T>(
  target: Pick<ResolvedTarget, 'tabId' | 'frameId'>,
  message: PageRequest,
): Promise<T> {
  return chrome.tabs.sendMessage(target.tabId, message, {
    frameId: target.frameId,
  });
}

async function pageContext(target: ResolvedTarget): Promise<PageContext> {
  try {
    const context = await sendToPage<PageContext | undefined>(target, {
      type: 'RESPAWN/PAGE_CONTEXT',
    });
    if (context?.url) return context;
  } catch {
    // Fall back to the tab URL below (content script may not be injected yet).
  }
  const tab = await chrome.tabs.get(target.tabId);
  if (!tab.url) {
    throw new CheckpointError('The page URL is unavailable.');
  }
  const url = new URL(tab.url);
  return {
    url: tab.url,
    origin: url.origin,
    route: `${url.pathname}${url.search}${url.hash}`,
  };
}

async function pageGo(target: ResolvedTarget, route: string) {
  let response: { ok: boolean; error?: string } | undefined;
  try {
    response = await sendToPage(target, { type: 'RESPAWN/PAGE_GO', route });
  } catch {
    response = undefined;
  }
  if (!response?.ok) {
    throw new CheckpointError(
      response?.error ?? `Navigation to “${route}” failed.`,
    );
  }
}

function toast(target: ResolvedTarget, text: string, kind: ToastKind) {
  // Toasts go to the top frame so they are always visible.
  void sendToPage(
    { tabId: target.tabId, frameId: 0 },
    {
      type: 'RESPAWN/PAGE_TOAST',
      text,
      kind,
    },
  ).catch(() => undefined);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// State (de)serialization.

const DATA_TYPE_KEY = Symbol.for('__serializedType__');
const DATA_REF_KEY = Symbol.for('__serializedRef__');

// Same as @redux-devtools/app-core parseJSON's reviver, so a stored state
// parses back into what the background store holds.
function reviver(key: string, value: unknown) {
  if (
    typeof value === 'object' &&
    value !== null &&
    '__serializedType__' in value &&
    typeof (value as { data?: unknown }).data === 'object'
  ) {
    const typed = value as {
      data: Record<symbol, unknown>;
      __serializedType__: unknown;
      __serializedRef__?: unknown;
    };
    typed.data[DATA_TYPE_KEY] = typed.__serializedType__;
    if ('__serializedRef__' in typed) {
      typed.data[DATA_REF_KEY] = typed.__serializedRef__;
    }
    return typed.data;
  }
  return value;
}

function parseState(record: CheckpointRecord): unknown {
  try {
    return record.serialize
      ? jsan.parse(record.state, reviver)
      : jsan.parse(record.state);
  } catch {
    throw new CheckpointError(
      `“${record.name}” could not be decoded. Delete it and save a new checkpoint.`,
    );
  }
}

/**
 * Build what the page expects for `IMPORT`: a lifted state holding only the
 * checkpoint. The page script turns it into `IMPORT_STATE { nextLiftedState }`,
 * which Redux's instrument, NgRx store-devtools and other `connect()` clients
 * all apply (regardless of `features.import`).
 */
export function buildImportPayload(
  state: unknown,
  name: string,
  serialize: boolean | undefined,
): string {
  const liftedState: State = {
    actionsById: {
      0: {
        type: 'PERFORM_ACTION',
        action: { type: `@@reSpawn/RESTORE ${name}` },
        timestamp: Date.now(),
      } as State['actionsById'][number],
    },
    computedStates: [{ state }],
    committedState: state,
    currentStateIndex: 0,
    nextActionId: 1,
    skippedActionIds: [],
    stagedActionIds: [0],
  };
  return stringifyJSON(liftedState, serialize);
}

function importInto(
  target: ResolvedTarget,
  instanceKey: string,
  payload: string,
) {
  postToTab(target.connectionId, {
    type: 'IMPORT',
    action: undefined,
    state: payload,
    id: instanceKey.replace(/^[^/]+\//, ''),
  });
}

// ---------------------------------------------------------------------------
// Request handlers.

async function save(
  request: Extract<CheckpointRequest, { type: 'RESPAWN/SAVE' }>,
  sender: chrome.runtime.MessageSender,
): Promise<ResponseMap['RESPAWN/SAVE']> {
  const target = resolveTarget(request, sender);
  const stop = await wake(target);
  try {
    const instanceKey = pickInstance(target);
    if (!instanceKey) {
      throw new CheckpointError(
        'No Redux DevTools store is connected on this page.',
      );
    }
    const { states, options } = store.getState().instances;
    const lifted = states[instanceKey];
    const current = lifted.computedStates[lifted.currentStateIndex];
    if (!current) throw new CheckpointError('The store has no state yet.');

    const context = await pageContext(target);
    const serialize = !!options[instanceKey].serialize;
    const state = stringifyJSON(current.state, serialize);
    if (typeof state !== 'string') {
      throw new CheckpointError('The current state could not be serialized.');
    }
    const index = await readIndex();
    const pathname = new URL(context.url).pathname || '/';
    const name = request.name?.trim()
      ? request.name.trim()
      : nextAutomaticName(
          pathname,
          index
            .filter((item) => item.origin === context.origin)
            .map((item) => item.name),
        );
    const instanceName = options[instanceKey].name;
    const record: CheckpointRecord = {
      version: 1,
      id: createCheckpointId(),
      name,
      origin: context.origin,
      route: context.route,
      url: context.url,
      instanceName:
        instanceName === undefined ? undefined : String(instanceName),
      createdAt: new Date().toISOString(),
      size: state.length,
      serialize,
      state,
    };
    const checkpoint = await putRecord(record);
    toast(target, `Saved “${checkpoint.name}”`, 'success');
    return { checkpoint };
  } finally {
    stop();
  }
}

async function restore(
  request: Extract<CheckpointRequest, { type: 'RESPAWN/RESTORE' }>,
  sender: chrome.runtime.MessageSender,
): Promise<ResponseMap['RESPAWN/RESTORE']> {
  const record = await readRecord(request.id);
  const target = resolveTarget(request, sender);
  const context = await pageContext(target);
  if (context.origin !== record.origin) {
    throw new CheckpointError(
      `“${record.name}” was saved on ${record.origin}, but this page is ${context.origin}.`,
    );
  }
  const stop = await wake(target);
  try {
    const instanceKey = pickInstance(target, record.instanceName);
    if (!instanceKey) {
      throw new CheckpointError(
        'No Redux DevTools store is connected on this page.',
      );
    }
    const options = store.getState().instances.options[instanceKey];
    // The Redux enhancer drops imports unless `features.import` is enabled.
    if (options.lib === 'redux' && !options.features?.import) {
      throw new CheckpointError(
        'This store disables importing state (features.import), so it cannot be restored.',
      );
    }
    const payload = buildImportPayload(
      parseState(record),
      record.name,
      options.serialize,
    );

    importInto(target, instanceKey, payload);
    if (context.route !== record.route) {
      await pageGo(target, record.route);
      await delay(RESTORE_SETTLE_DELAY_MS);
      // Route guards/resolvers may have changed the state while navigating.
      importInto(target, instanceKey, payload);
    }
    // Let the page process the import before a possible STOP.
    await delay(100);

    const checkpoint = await updateMeta(record.id, (meta) => ({
      ...meta,
      lastUsedAt: new Date().toISOString(),
    }));
    toast(target, `Restored “${checkpoint.name}”`, 'success');
    return { checkpoint };
  } finally {
    stop();
  }
}

async function navigate(
  request: Extract<CheckpointRequest, { type: 'RESPAWN/NAVIGATE' }>,
  sender: chrome.runtime.MessageSender,
): Promise<ResponseMap['RESPAWN/NAVIGATE']> {
  const target = resolveTarget(request, sender);
  const context = await pageContext(target);
  const route = resolveRouteForUrl(request.route, context.url);
  if (!route) {
    throw new CheckpointError(
      `“${request.route}” is not a route. Start it with /, ./ or ../`,
    );
  }
  await pageGo(target, route);
  toast(target, `Navigated to ${route}`, 'info');
  return { route };
}

async function rename(
  request: Extract<CheckpointRequest, { type: 'RESPAWN/RENAME' }>,
): Promise<ResponseMap['RESPAWN/RENAME']> {
  const name = request.name.trim();
  if (!name) throw new CheckpointError('Please enter a checkpoint name.');
  const checkpoint = await updateMeta(request.id, (meta, index) => {
    const taken = index.some(
      (item) =>
        item.id !== meta.id &&
        item.origin === meta.origin &&
        item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (taken) {
      throw new CheckpointError(
        `A checkpoint named “${name}” already exists. Choose a different name.`,
      );
    }
    return { ...meta, name };
  });
  return { checkpoint };
}

async function importCheckpoint(
  request: Extract<CheckpointRequest, { type: 'RESPAWN/IMPORT' }>,
): Promise<ResponseMap['RESPAWN/IMPORT']> {
  const record = normalizeImportedCheckpoint(
    request.data,
    (state) => jsan.stringify(state),
    request.origin ?? '',
  );
  if (!record || !record.origin) {
    throw new CheckpointError(
      'Not a valid checkpoint file. Expected a version 1 reSpawn or inspector-ng checkpoint.',
    );
  }
  const index = await readIndex();
  const name = nextAutomaticName(
    record.name,
    index
      .filter((item) => item.origin === record.origin)
      .map((item) => item.name),
  );
  const checkpoint = await putRecord({ ...record, name });
  return { checkpoint };
}

async function handle(
  request: CheckpointRequest,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (request.type) {
    case 'RESPAWN/LIST':
      return { checkpoints: await readIndex() };
    case 'RESPAWN/CONTEXT': {
      const target = resolveTarget(request, sender);
      const instanceKey = pickInstance(target);
      const name =
        instanceKey && store.getState().instances.options[instanceKey]?.name;
      return {
        context: await pageContext(target),
        instanceName: name === undefined ? undefined : String(name),
      };
    }
    case 'RESPAWN/SAVE':
      return save(request, sender);
    case 'RESPAWN/RESTORE':
      return restore(request, sender);
    case 'RESPAWN/NAVIGATE':
      return navigate(request, sender);
    case 'RESPAWN/RENAME':
      return rename(request);
    case 'RESPAWN/DELETE':
      await deleteRecord(request.id);
      return {};
    case 'RESPAWN/EXPORT':
      return { record: await readRecord(request.id) };
    case 'RESPAWN/IMPORT':
      return importCheckpoint(request);
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (!isCheckpointRequest(message)) return false;
    handle(message, sender).then(
      (result) => sendResponse({ ok: true, ...(result as object) }),
      (error: unknown) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error && error.message
              ? error.message
              : 'The checkpoint request failed.',
        }),
    );
    return true;
  },
);
