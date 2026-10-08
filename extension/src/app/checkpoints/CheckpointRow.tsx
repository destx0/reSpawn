import React, { useEffect, useState } from 'react';
import {
  CheckpointMeta,
  formatRelativeTime,
  formatSize,
} from '../../checkpoints/core.js';
import {
  Hint,
  Input,
  Row,
  RowActions,
  RowMain,
  RowMeta,
  RowName,
  SmallButton,
} from './styles.js';

interface Props {
  readonly checkpoint: CheckpointMeta;
  readonly showOrigin: boolean;
  readonly canRestore: boolean;
  readonly busy: boolean;
  readonly onRestore: () => void;
  readonly onGo: () => void;
  readonly onRename: (name: string) => Promise<boolean>;
  readonly onExport: () => void;
  readonly onDelete: () => void;
}

export default function CheckpointRow({
  checkpoint,
  showOrigin,
  canRestore,
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

  const activity = checkpoint.lastUsedAt ?? checkpoint.createdAt;
  const restoreTitle = canRestore
    ? 'Restore this state and navigate to its route'
    : `Open ${checkpoint.origin} to restore this checkpoint`;

  return (
    <Row>
      <RowMain>
        {renaming ? (
          <Input
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
          <RowName
            title="Click to rename"
            onClick={() => {
              setName(checkpoint.name);
              setRenaming(true);
            }}
            onDoubleClick={() => canRestore && onRestore()}
          >
            {checkpoint.name}
          </RowName>
        )}
        <Hint title={checkpoint.url}>
          {showOrigin
            ? `${checkpoint.origin}${checkpoint.route}`
            : checkpoint.route}
        </Hint>
      </RowMain>
      <RowMeta title={new Date(activity).toLocaleString()}>
        {formatRelativeTime(activity)} · {formatSize(checkpoint.size)}
      </RowMeta>
      <RowActions>
        <SmallButton
          primary
          disabled={!canRestore}
          title={restoreTitle}
          onClick={onRestore}
        >
          Restore
        </SmallButton>
        <SmallButton
          disabled={!canRestore}
          title="Navigate to this route without changing state"
          onClick={onGo}
        >
          Go
        </SmallButton>
        <SmallButton
          disabled={busy}
          title="Download as JSON"
          onClick={onExport}
        >
          Export
        </SmallButton>
        <SmallButton
          danger
          disabled={busy}
          onClick={() => {
            if (confirmDelete) onDelete();
            else setConfirmDelete(true);
          }}
        >
          {confirmDelete ? 'Confirm' : 'Delete'}
        </SmallButton>
      </RowActions>
    </Row>
  );
}
