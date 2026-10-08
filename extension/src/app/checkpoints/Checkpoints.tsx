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
  FiAlertCircle,
  FiArrowRight,
  FiBookmark,
  FiCheck,
  FiGlobe,
  FiPlus,
  FiSearch,
  FiUpload,
} from 'react-icons/fi';
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
import {
  ALL_SITES_KEY,
  downloadCheckpoint,
  readAllSites,
  readCheckpointFile,
  writeAllSites,
} from '../../checkpoints/files.js';
import CheckpointRow from './CheckpointRow.js';
import {
  Badge,
  Empty,
  Header,
  Host,
  IconButton,
  Input,
  Kbd,
  List,
  Location,
  Mono,
  Page,
  Row,
  RowMain,
  RowName,
  SearchBox,
  Status,
} from './styles.js';

const INDEX_KEY = 'respawn:checkpoints:index';

type StatusMessage = { kind: 'error' | 'success'; text: string } | null;

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
  const [allSites, setAllSites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status?.kind !== 'success') return;
    const timer = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(timer);
  }, [status]);

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
      setInstanceName(undefined);
    }
  }, [target]);

  useEffect(() => {
    const initial = setTimeout(() => {
      void loadList();
      void readAllSites().then(setAllSites);
    }, 0);
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes[INDEX_KEY]) void loadList();
      if (changes[ALL_SITES_KEY]) {
        setAllSites(changes[ALL_SITES_KEY].newValue === true);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      clearTimeout(initial);
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [loadList]);

  // The page URL changes as the app navigates; poll it while visible.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void loadContext();
    };
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
    return isRouteQuery(query.trim()) ? [] : fuzzyCheckpoints(scoped, query);
  }, [allSites, checkpoints, context, query]);

  const routeQuery = isRouteQuery(query.trim());
  const resolvedRoute = useMemo(() => {
    if (!context || !routeQuery) return null;
    try {
      return resolveRouteForUrl(query.trim(), context.url);
    } catch {
      return null;
    }
  }, [context, query, routeQuery]);

  const save = async () => {
    await run({ type: 'RESPAWN/SAVE', ...target }, (r) =>
      r.ok ? `Saved “${r.checkpoint.name}”` : '',
    );
  };

  const go = async () => {
    if (!resolvedRoute || !target) return;
    const response = await run(
      { type: 'RESPAWN/NAVIGATE', ...target, route: query.trim() },
      (r) => (r.ok ? `Went to ${r.route}` : ''),
    );
    if (response.ok) setQuery('');
  };

  const importFile = async (file: File) => {
    let data: unknown;
    try {
      data = await readCheckpointFile(file);
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message });
      return;
    }
    await run({ type: 'RESPAWN/IMPORT', data, origin: context?.origin }, (r) =>
      r.ok ? `Imported “${r.checkpoint.name}”` : '',
    );
  };

  const exportCheckpoint = async (checkpoint: CheckpointMeta) => {
    const response = await run({ type: 'RESPAWN/EXPORT', id: checkpoint.id });
    if (response.ok) downloadCheckpoint(response.record);
  };

  const otherSites = context
    ? checkpoints.filter((item) => item.origin !== context.origin).length
    : 0;

  return (
    <Page>
      <Header>
        <Location
          title={[context?.url, instanceName].filter(Boolean).join('\n')}
        >
          <Host>{context ? new URL(context.url).host : 'No page'}</Host>
          {context && <Mono>{context.route}</Mono>}
        </Location>
        <IconButton
          active={allSites}
          title={allSites ? 'Showing all sites' : 'Show all sites'}
          onClick={() => void writeAllSites(!allSites)}
        >
          <FiGlobe />
          {!allSites && otherSites > 0 && <Badge>{otherSites}</Badge>}
        </IconButton>
        <IconButton
          title="Import JSON"
          onClick={() => fileInput.current?.click()}
        >
          <FiUpload />
        </IconButton>
        <IconButton
          primary
          disabled={!hasStore || busy}
          onClick={() => void save()}
          title="Save checkpoint (Alt+S)"
        >
          <FiPlus />
        </IconButton>
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
      </Header>

      <SearchBox>
        <FiSearch />
        <Input
          value={query}
          placeholder="Search, or go to /route, ./child, ../"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && resolvedRoute) void go();
            if (event.key === 'Escape') setQuery('');
          }}
          spellCheck={false}
        />
      </SearchBox>

      {status && (
        <Status
          kind={status.kind}
          title="Dismiss"
          onClick={() => setStatus(null)}
        >
          {status.kind === 'error' ? <FiAlertCircle /> : <FiCheck />}
          {status.text}
        </Status>
      )}

      <List>
        {routeQuery && (
          <Row accent onClick={() => resolvedRoute && void go()}>
            <FiArrowRight />
            <RowMain>
              <RowName>{resolvedRoute ?? query.trim()}</RowName>
              <Mono>
                {resolvedRoute ? 'Go to route, keep state' : 'Invalid route'}
              </Mono>
            </RowMain>
            {resolvedRoute && target && <Kbd>↵</Kbd>}
          </Row>
        )}
        {visible.length === 0 && !routeQuery && (
          <Empty>
            <FiBookmark />
            {checkpoints.length === 0 ? (
              <span>
                No checkpoints · <Kbd>Alt</Kbd> <Kbd>S</Kbd> to save
              </span>
            ) : query ? (
              'No matches'
            ) : (
              'No checkpoints for this site'
            )}
          </Empty>
        )}
        {visible.map((checkpoint) => (
          <CheckpointRow
            key={checkpoint.id}
            checkpoint={checkpoint}
            showOrigin={allSites}
            restoreMode={
              !target || !context ? 'disabled' : hasStore ? 'restore' : 'open'
            }
            canGo={!!target}
            busy={busy}
            onRestore={() =>
              void run(
                // `open` loads the checkpoint route first when there is no store.
                {
                  type: 'RESPAWN/RESTORE',
                  id: checkpoint.id,
                  open: true,
                  ...target,
                },
                (r) => (r.ok ? `Restored “${r.checkpoint.name}”` : ''),
              )
            }
            onGo={() =>
              void run(
                {
                  type: 'RESPAWN/NAVIGATE',
                  route: checkpoint.route,
                  ...target,
                },
                (r) => (r.ok ? `Went to ${r.route}` : ''),
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
