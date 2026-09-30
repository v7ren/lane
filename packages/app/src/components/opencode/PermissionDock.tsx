import { useMemo, useState } from 'react';
import type { TimelineApproval } from '../../lib/agent-timeline-reducer';
import {
  pendingPermissionSessionId,
  type OpenCodePermissionReply,
  type PendingPermission,
} from '../../lib/opencode/pending-requests';

const METADATA_PREVIEW_LINES = 8;

export type PermissionDockItem = {
  id: string;
  permissionName: string;
  patterns: string[];
  metadataText?: string;
  always: string[];
  submitting?: boolean;
  receivedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function formatMetadataBlock(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined;
  const keys = Object.keys(metadata);
  if (keys.length === 0) return undefined;
  if (typeof metadata.diff === 'string' && metadata.diff.trim()) {
    return metadata.diff;
  }
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
}

export function buildPermissionDockItems(args: {
  isOpenCodePane: boolean;
  sessionId: string | null;
  pendingPermissions: PendingPermission[];
  pendingProtocolApprovals: TimelineApproval[];
}): PermissionDockItem[] {
  const { isOpenCodePane, sessionId, pendingPermissions, pendingProtocolApprovals } = args;

  const fromStore = pendingPermissions
    .filter((entry) => !sessionId || pendingPermissionSessionId(entry) === sessionId)
    .map((entry) => pendingPermissionToDockItem(entry));

  if (isOpenCodePane) {
    return fromStore;
  }

  if (fromStore.length > 0) {
    return fromStore;
  }

  return pendingProtocolApprovals.map((a, index) => ({
    id: a.id,
    permissionName: a.title,
    patterns: a.detail ? [a.detail] : [],
    always: [],
    receivedAt: index,
  }));
}

export function pendingPermissionToDockItem(entry: PendingPermission): PermissionDockItem {
  const raw = entry as Record<string, unknown>;
  const data = isRecord(raw.data) ? raw.data : undefined;

  const permissionName = String(
    data?.permission ?? raw.permission ?? 'Permission required',
  );

  let patterns: string[] = [];
  const patternSource = data?.patterns ?? raw.patterns;
  if (Array.isArray(patternSource)) {
    patterns = patternSource.map((p) => String(p));
  }
  if (patterns.length === 0) {
    const single =
      data?.pattern ?? raw.pattern ?? data?.command ?? raw.command ?? data?.title ?? raw.title;
    if (typeof single === 'string' && single.trim()) {
      patterns = [single];
    }
  }

  const alwaysSource = data?.always ?? raw.always;
  const always = Array.isArray(alwaysSource) ? alwaysSource.map((a) => String(a)) : [];

  const metadata = data?.metadata ?? raw.metadata;
  const metadataText = formatMetadataBlock(metadata);

  return {
    id: String(raw.id ?? ''),
    permissionName,
    patterns,
    metadataText,
    always,
    submitting: Boolean(entry.submitting),
    receivedAt: entry.receivedAt,
  };
}

function MetadataBlock({ text, disabled }: { text: string; disabled: boolean }) {
  const lines = text.split('\n');
  const needsCollapse = lines.length > METADATA_PREVIEW_LINES;
  const [expanded, setExpanded] = useState(false);
  const visible = expanded || !needsCollapse ? text : lines.slice(0, METADATA_PREVIEW_LINES).join('\n');

  return (
    <div className="space-y-1">
      <pre
        className="text-[11px] font-mono text-text-2 whitespace-pre-wrap break-all rounded-md border border-border-subtle/60 bg-elevated/50 px-2 py-1.5 max-h-48 overflow-y-auto"
        data-testid="permission-dock-metadata"
      >
        {visible}
        {!expanded && needsCollapse ? '\n…' : ''}
      </pre>
      {needsCollapse ? (
        <button
          type="button"
          disabled={disabled}
          className="text-meta text-accent hover:underline disabled:opacity-40"
          data-testid="permission-dock-metadata-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

function PermissionDockCard({
  item,
  queueLabel,
  disabled,
  onReply,
}: {
  item: PermissionDockItem;
  queueLabel: string | null;
  disabled: boolean;
  onReply: (id: string, reply: OpenCodePermissionReply) => void;
}) {
  const patternText = item.patterns.join('\n');

  const handleReply = (reply: OpenCodePermissionReply) => {
    if (disabled) return;
    onReply(item.id, reply);
  };

  return (
    <div className="space-y-2" data-testid="permission-dock-card">
      {queueLabel ? (
        <p className="text-meta text-text-3" data-testid="permission-dock-queue">
          {queueLabel}
        </p>
      ) : null}
      <div className="min-w-0">
        <p className="text-body font-medium text-text" data-testid="permission-dock-tool">
          {item.permissionName}
        </p>
        {patternText ? (
          <p
            className="text-meta text-text-2 whitespace-pre-wrap break-all mt-0.5"
            data-testid="permission-dock-pattern"
          >
            {patternText}
          </p>
        ) : null}
      </div>
      {item.metadataText ? <MetadataBlock text={item.metadataText} disabled={disabled} /> : null}
      <div className="flex flex-wrap items-start gap-2 pt-0.5">
        <button
          type="button"
          disabled={disabled}
          data-testid="permission-dock-allow-once"
          className="px-3 py-1 rounded-full bg-accent text-white text-meta disabled:opacity-40"
          onClick={() => handleReply('once')}
        >
          Allow once
        </button>
        <div className="flex flex-col items-start gap-0.5">
          <button
            type="button"
            disabled={disabled}
            data-testid="permission-dock-allow-always"
            className="px-3 py-1 rounded-full border border-border-subtle bg-elevated text-meta hover:bg-hover disabled:opacity-40"
            onClick={() => handleReply('always')}
          >
            Always allow
          </button>
          {item.always.length > 0 ? (
            <p className="text-[11px] text-text-3 max-w-xs" data-testid="permission-dock-always-list">
              {item.always.join(', ')}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={disabled}
          data-testid="permission-dock-reject"
          className="px-3 py-1 rounded-full border border-status-error/40 text-status-error text-meta hover:bg-status-error/10 disabled:opacity-40"
          onClick={() => handleReply('reject')}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

export function PermissionDock({
  permissions,
  busy,
  lastRequestError,
  onReply,
}: {
  permissions: PermissionDockItem[];
  busy: boolean;
  lastRequestError?: string | null;
  onReply: (id: string, reply: OpenCodePermissionReply) => void;
}) {
  const sorted = useMemo(
    () => [...permissions].sort((a, b) => a.receivedAt - b.receivedAt),
    [permissions],
  );

  if (sorted.length === 0) return null;

  const current = sorted[0];
  const queueLabel = sorted.length > 1 ? `1 of ${sorted.length}` : null;
  const disabled = busy || Boolean(current.submitting);

  return (
    <div
      className="border-t border-status-approval/40 bg-status-approval/10 px-3 py-2 space-y-2 shrink-0"
      data-testid="permission-dock"
    >
      {lastRequestError ? (
        <p className="text-meta text-status-error" data-testid="permission-dock-error">
          {lastRequestError}
        </p>
      ) : null}
      <PermissionDockCard
        item={current}
        queueLabel={queueLabel}
        disabled={disabled}
        onReply={onReply}
      />
    </div>
  );
}
