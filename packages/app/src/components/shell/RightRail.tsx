import { useState } from 'react';
import { DISPLAY_STATUS_LABEL } from '../../lib/display-status';
import {
  useEnvironment,
  useSelectedSession,
  useSessionSummary,
} from '../../lib/shell-data';

type Tab = 'session' | 'environment';

export function RightRail() {
  const [tab, setTab] = useState<Tab>('session');
  const session = useSelectedSession();
  const summary = useSessionSummary(session);
  const env = useEnvironment();

  return (
    <aside
      className="flex flex-col min-h-0 h-full bg-surface border-l border-border-subtle"
      data-testid="right-rail"
    >
      <div className="flex border-b border-border-subtle shrink-0 h-7">
        <TabButton active={tab === 'session'} onClick={() => setTab('session')}>
          Session
        </TabButton>
        <TabButton active={tab === 'environment'} onClick={() => setTab('environment')}>
          Environment
        </TabButton>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-body">
        {tab === 'session' && (
          <div className="space-y-3" data-testid="right-rail-session">
            {!session && <p className="text-meta text-text-3">No session selected.</p>}
            {session && (
              <>
                <Field label="Agent" value={summary.agent ?? session.agentLabel} />
                <Field label="Model" value={summary.model ?? '—'} />
                {summary.provider && <Field label="Provider" value={summary.provider} />}
                <Field label="Status" value={DISPLAY_STATUS_LABEL[session.status]} />
                {summary.tokens && (
                  <Field
                    label="Tokens"
                    value={`${summary.tokens.input} in · ${summary.tokens.output} out`}
                  />
                )}
                {summary.costUsd != null && (
                  <Field label="Cost" value={`$${summary.costUsd.toFixed(4)}`} />
                )}
                {session.shareUrl && (
                  <Field label="OpenCode share" value={session.shareUrl} mono />
                )}
                <div>
                  <div className="text-section-label text-text-3 mb-2">Todos</div>
                  <ul className="space-y-1.5">
                    {(summary.todos ?? []).map((todo) => (
                      <li
                        key={todo.content}
                        className="text-meta text-text-2 flex gap-2 items-start"
                      >
                        <span className="text-text-3 uppercase text-[10px]">{todo.status}</span>
                        <span>{todo.content}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}
        {tab === 'environment' && (
          <div className="space-y-3" data-testid="right-rail-environment">
            <Field label="Directory" value={env.directory ?? '—'} mono />
            <Field label="Branch" value={env.branch ?? '—'} />
            <Field label="OpenCode server" value={env.serverUrl ?? '—'} mono />
            <Field label="Server status" value={env.serverStatus ?? '—'} />
            <Field label="MCP" value={env.mcpSummary ?? '—'} />
            <Field label="LSP" value={env.lspSummary ?? '—'} />
          </div>
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 h-7 px-3 text-section-label transition-colors duration-ui border-b-2 ${
        active
          ? 'text-text border-accent'
          : 'text-text-3 border-transparent hover:text-text-2'
      }`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-section-label text-text-3 mb-0.5">{label}</div>
      <div className={`text-meta text-text-2 break-all ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
