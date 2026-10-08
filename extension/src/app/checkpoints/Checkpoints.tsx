import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSelector } from 'react-redux';
import { getActiveInstance, StoreState } from '@redux-devtools/app';
import {
  CheckpointMeta,
  fuzzyCheckpoints,
  isRouteQuery,
  resolveRouteForUrl,
} from '../../checkpoints/core.js';
import {
  CheckpointRequest,
  CheckpointResponse,
  CheckpointTarget,
  PageContext,
  requestCheckpoints,
  ResponseMap,
} from '../../checkpoints/messages.js';
import CheckpointRow from './CheckpointRow.js';
import {
  Banner,
  Bar,
  Field,
  Hint,
  InlineHint,
  Input,
  List,
  Page,
  PillButton,
  Section,
  SectionTitle,
  Toggle,
} from './styles.js';

const INDEX_KEY = 'respawn:checkpoints:index';

type Status = { kind: 'error' | 'success'; text: string } | null;

function downloadJson(fileName: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileNameFor(checkpoint: CheckpointMeta) {
  const slug = checkpoint.name
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `respawn-${slug || 'checkpoint'}.json`;
}

function inspectedTabId(): number | undefined {
  return typeof chrome !== 'undefined'
    ? chrome.devtools?.inspectedWindow?.tabId
    : undefined;
}

/** Checkpoints tab of the DevTools app (selected instance from the store). */
export default function Checkpoints() {
  const instanceKey = useSelector((state: StoreState) =>
    getActiveInstance(state.instances),
  );
  return (
    <CheckpointsPanel instanceKey={instanceKey} tabId={inspectedTabId()} />
  );
}

/** Checkpoints for the inspected tab when it has no store (yet). */
export function NoStoreCheckpoints() {
  const tabId = inspectedTabId();
  return tabId === undefined ? null : <CheckpointsPanel tabId={tabId} />;
}

interface PanelProps {
  /** Selected DevTools instance (`<tabId>/<id>`), when a store is connected. */
  readonly instanceKey?: string | number;
  /** Inspected tab, used when there is no store to target. */
  readonly tabId?: number;
}

export function CheckpointsPanel({ instanceKey, tabId }: PanelProps) {
  const hasStore = instanceKey !== 'default' && instanceKey !== undefined;
  const target = useMemo<CheckpointTarget | null>(
    () => (hasStore ? { instanceKey } : tabId !== undefined ? { tabId } : null),
    [hasStore, instanceKey, tabId],
  );

  const [checkpoints, setCheckpoints] = useState<CheckpointMeta[]>([]);
  const [context, setContext] = useState<PageContext | null>(null);
  const [instanceName, setInstanceName] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [route, setRoute] = useState('');
  const [saveName, setSaveName] = useState('');
  const [allSites, setAllSites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    const response = await requestCheckpoints({ type: 'RESPAWN/LIST' });
    if (response.ok) setCheckpoints(response.checkpoints);
    else setStatus({ kind: 'error', text: response.error });
  }, []);

  const loadContext = useCallback(async () => {
    if (!target) {
      setContext(null);
      return;
    }
    const response = await requestCheckpoints({
      type: 'RESPAWN/CONTEXT',
      ...target,
    });
    if (response.ok) {
      setContext(response.context);
      setInstanceName(response.instanceName);
    } else {
      setContext(null);
    }
  }, [target]);

  useEffect(() => {
    const initial = setTimeout(() => void loadList(), 0);
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === 'local' && changes[INDEX_KEY]) void loadList();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      clearTimeout(initial);
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [loadList]);

  // The page URL changes as the app navigates; poll it while visible.
  useEffect(() => {
    const tick = () => void loadContext();
    const initial = setTimeout(tick, 0);
    const timer = setInterval(tick, 2000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [loadContext]);

  const run = useCallback(
    async <R extends CheckpointRequest>(
      request: R,
      success?: (result: CheckpointResponse<ResponseMap[R['type']]>) => string,
    ) => {
      setBusy(true);
      setStatus(null);
      try {
        const response = await requestCheckpoints(request);
        if (!response.ok) {
          setStatus({ kind: 'error', text: response.error });
        } else if (success) {
          setStatus({ kind: 'success', text: success(response) });
        }
        void loadContext();
        return response;
      } finally {
        setBusy(false);
      }
    },
    [loadContext],
  );

  const visible = useMemo(() => {
    const scoped =
      allSites || !context
        ? checkpoints
        : checkpoints.filter((item) => item.origin === context.origin);
    return fuzzyCheckpoints(scoped, query);
  }, [allSites, checkpoints, context, query]);

  const resolvedRoute = useMemo(() => {
    if (!context || !isRouteQuery(route)) return null;
    try {
      return resolveRouteForUrl(route, context.url);
    } catch {
      return null;
    }
  }, [context, route]);

  const save = async () => {
    const response = await run(
      { type: 'RESPAWN/SAVE', ...target, name: saveName || undefined },
      (r) => (r.ok ? `Saved “${r.checkpoint.name}”.` : ''),
    );
    if (response.ok) setSaveName('');
  };

  const go = async () => {
    if (!route.trim() || !target) return;
    const response = await run(
      { type: 'RESPAWN/NAVIGATE', ...target, route },
      (r) => (r.ok ? `Navigated to ${r.route}.` : ''),
    );
    if (response.ok) setRoute('');
  };

  const importFile = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setStatus({ kind: 'error', text: `${file.name} is not valid JSON.` });
      return;
    }
    await run({ type: 'RESPAWN/IMPORT', data, origin: context?.origin }, (r) =>
      r.ok ? `Imported “${r.checkpoint.name}”.` : '',
    );
  };

  const exportCheckpoint = async (checkpoint: CheckpointMeta) => {
    const response = await run({ type: 'RESPAWN/EXPORT', id: checkpoint.id });
    if (response.ok) downloadJson(fileNameFor(checkpoint), response.record);
  };

  const otherSites = context
    ? checkpoints.filter((item) => item.origin !== context.origin).length
    : 0;

  return (
    <Page>
      <Section>
        <Bar>
          <div style={{ minWidth: 0, flex: 1 }}>
            <SectionTitle>
              {context ? new URL(context.url).host : 'No page'}
              {instanceName && <InlineHint> · {instanceName}</InlineHint>}
            </SectionTitle>
            <Hint title={context?.url}>
              {context
                ? context.route
                : target
                  ? 'Connecting to the page…'
                  : 'No page to inspect.'}
            </Hint>
          </div>
        </Bar>
        <Bar>
          <Field>
            <Input
              value={saveName}
              placeholder="Name (optional, defaults to the route)"
              onChange={(event) => setSaveName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save();
              }}
              disabled={!hasStore}
            />
          </Field>
          <PillButton
            primary
            disabled={!hasStore || busy}
            onClick={() => void save()}
            title="Save the current state and route (Alt+S on the page)"
          >
            Save checkpoint
          </PillButton>
        </Bar>
        <Bar>
          <Field>
            <Input
              value={route}
              placeholder="Go to /route, ./child or ../sibling (no state change)"
              onChange={(event) => setRoute(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void go();
              }}
              disabled={!target}
              spellCheck={false}
            />
            {route.trim() && (
              <Hint>
                {resolvedRoute
                  ? `→ ${resolvedRoute}`
                  : 'Start with /, ./ or ../'}
              </Hint>
            )}
          </Field>
          <PillButton
            disabled={!target || busy || !resolvedRoute}
            onClick={() => void go()}
          >
            Go
          </PillButton>
        </Bar>
      </Section>

      {status && <Banner kind={status.kind}>{status.text}</Banner>}

      <Section>
        <Bar>
          <Field>
            <Input
              value={query}
              placeholder="Search checkpoints"
              onChange={(event) => setQuery(event.target.value)}
              spellCheck={false}
            />
          </Field>
          <Toggle>
            <input
              type="checkbox"
              checked={allSites}
              onChange={(event) => setAllSites(event.target.checked)}
            />
            All sites{otherSites ? ` (+${otherSites})` : ''}
          </Toggle>
          <PillButton onClick={() => fileInput.current?.click()}>
            Import
          </PillButton>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importFile(file);
            }}
          />
        </Bar>
      </Section>

      <List>
        {visible.length === 0 && (
          <Hint style={{ padding: 16, textAlign: 'center' }}>
            {checkpoints.length === 0
              ? 'No checkpoints yet. Press Alt+S on the page or click Save checkpoint.'
              : query
                ? 'No checkpoints match.'
                : 'No checkpoints for this site.'}
          </Hint>
        )}
        {visible.map((checkpoint) => (
          <CheckpointRow
            key={checkpoint.id}
            checkpoint={checkpoint}
            showOrigin={allSites}
            restoreMode={
              !target || !context
                ? 'disabled'
                : context.origin === checkpoint.origin && hasStore
                  ? 'restore'
                  : 'open'
            }
            canGo={!!target && context?.origin === checkpoint.origin}
            busy={busy}
            onRestore={() =>
              void run(
                // `open` loads the checkpoint URL first when needed.
                {
                  type: 'RESPAWN/RESTORE',
                  id: checkpoint.id,
                  open: true,
                  ...target,
                },
                (r) => (r.ok ? `Restored “${r.checkpoint.name}”.` : ''),
              )
            }
            onGo={() =>
              void run(
                {
                  type: 'RESPAWN/NAVIGATE',
                  route: checkpoint.route,
                  ...target,
                },
                (r) => (r.ok ? `Navigated to ${r.route}.` : ''),
              )
            }
            onRename={async (name) => {
              const response = await run({
                type: 'RESPAWN/RENAME',
                id: checkpoint.id,
                name,
              });
              return response.ok;
            }}
            onExport={() => void exportCheckpoint(checkpoint)}
            onDelete={() =>
              void run({ type: 'RESPAWN/DELETE', id: checkpoint.id })
            }
          />
        ))}
      </List>
    </Page>
  );
}
