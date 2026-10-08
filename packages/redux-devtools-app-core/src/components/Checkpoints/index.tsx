import React from 'react';

/**
 * Checkpoints need the browser extension (storage, tabs, in-page navigation),
 * so the extension renders its own panel (extension/src/app/checkpoints).
 * This placeholder is what the standalone app and other hosts show.
 */
export default function Checkpoints() {
  return (
    <div style={{ padding: 20, textAlign: 'center' }}>
      Checkpoints are available in the reSpawn browser extension.
    </div>
  );
}
