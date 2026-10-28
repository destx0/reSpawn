import React, { useEffect, useState } from 'react';
import {
  FiArrowRight,
  FiBookmark,
  FiCheck,
  FiDownload,
  FiEdit2,
  FiExternalLink,
  FiRotateCcw,
  FiTrash2,
} from 'react-icons/fi';
import {
  CheckpointMeta,
  formatRelativeTime,
  formatSize,
} from '../../checkpoints/core.js';
import {
  Actions,
  IconButton,
  Mono,
  RenameInput,
  Row,
  RowMain,
  RowName,
} from './styles.js';

interface Props {
  readonly checkpoint: CheckpointMeta;
  /** Route translated to the current environment, when a mapping applies. */
  readonly displayRoute: string;
  readonly showOrigin: boolean;
  /** `open` loads the checkpoint URL in this tab before restoring. */
  readonly restoreMode: 'restore' | 'open' | 'disabled';
  readonly canGo: boolean;
  readonly busy: boolean;
  readonly onRestore: () => void;
  readonly onGo: () => void;
  readonly onRename: (name: string) => Promise<boolean>;
  readonly onExport: () => void;
  readonly onDelete: () => void;
}

export default function CheckpointRow({
  checkpoint,
  displayRoute,
  showOrigin,
  restoreMode,
  canGo,
  busy,
  onRestore,
  onGo,
  onRename,
  onExport,
  onDelete,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(checkpoint.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  const submitRename = async () => {
    if (name.trim() === checkpoint.name) {
      setRenaming(false);
      return;
    }
    if (await onRename(name)) setRenaming(false);
  };

  const startRename = () => {
    setName(checkpoint.name);
    setRenaming(true);
  };

  const activity = checkpoint.lastUsedAt ?? checkpoint.createdAt;
  const canRestore = restoreMode !== 'disabled' && !busy;
  const location = showOrigin
    ? `${checkpoint.origin}${displayRoute}`
    : displayRoute;

  return (
    <Row
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button, input')) return;
        if (canRestore) onRestore();
      }}
    >
      <FiBookmark />
      <RowMain>
        {renaming ? (
          <RenameInput
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void submitRename()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitRename();
              if (event.key === 'Escape') {
                setName(checkpoint.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <RowName title={checkpoint.name}>{checkpoint.name}</RowName>
        )}
        <Mono
          title={`${checkpoint.url}\n${new Date(activity).toLocaleString()} · ${formatSize(checkpoint.size)}`}
        >
          {checkpoint.name === location ? '' : `${location} · `}
          {formatRelativeTime(activity)}
        </Mono>
      </RowMain>
      <Actions
        className="actions"
        style={confirmDelete || renaming ? { opacity: 1 } : undefined}
      >
        <IconButton
          primary
          disabled={!canRestore}
          title={
            restoreMode === 'open'
              ? 'Open in this tab and restore'
              : 'Restore state'
          }
          onClick={onRestore}
        >
          {restoreMode === 'open' ? <FiExternalLink /> : <FiRotateCcw />}
        </IconButton>
        <IconButton
          disabled={!canGo || busy}
          title="Go to route (keep state)"
          onClick={onGo}
        >
          <FiArrowRight />
        </IconButton>
        <IconButton disabled={busy} title="Rename" onClick={startRename}>
          <FiEdit2 />
        </IconButton>
        <IconButton disabled={busy} title="Export JSON" onClick={onExport}>
          <FiDownload />
        </IconButton>
        <IconButton
          danger={confirmDelete}
          disabled={busy}
          title={confirmDelete ? 'Click again to delete' : 'Delete'}
          onClick={() => {
            if (confirmDelete) onDelete();
            else setConfirmDelete(true);
          }}
        >
          {confirmDelete ? <FiCheck /> : <FiTrash2 />}
        </IconButton>
      </Actions>
    </Row>
  );
}
