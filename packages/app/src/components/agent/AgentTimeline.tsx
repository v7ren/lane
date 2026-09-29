import { useState } from 'react';
import type { ApprovalDecision } from '../../lib/agent-events';
import type { AgentTimelineViewModel, TimelineTool } from '../../lib/agent-timeline-reducer';

function ToolRow({ tool }: { tool: TimelineTool }) {
  const [open, setOpen] = useState(tool.status === 'running');
  return (
    <div className="rounded-lg border border-lr-border bg-lr-bg/60 text-xs">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-lr-raised/50"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-lr-muted">{open ? '▾' : '▸'}</span>
        <span className="font-mono text-lr-accent">{tool.name}</span>
        {tool.status === 'running' && (
          <span className="text-[10px] text-lr-warn animate-pulse">running</span>
        )}
        {tool.status === 'ok' && <span className="text-[10px] text-lr-ok">ok</span>}
        {tool.status === 'error' && <span className="text-[10px] text-lr-err">error</span>}
      </button>
      {open && (
        <div className="px-2.5 pb-2 space-y-1 text-lr-muted border-t border-lr-border/60">
          <p className="whitespace-pre-wrap pt-1">{tool.inputSummary}</p>
          {tool.outputSummary && (
            <p className="whitespace-pre-wrap text-lr-text">{tool.outputSummary}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalStrip({
  approval,
  busy,
  onRespond,
}: {
  approval: AgentTimelineViewModel['pendingApprovals'][number];
  busy: boolean;
  onRespond: (decision: ApprovalDecision) => void;
}) {
  return (
    <div className="rounded-lg border border-lr-warn/50 bg-lr-warn/10 p-3 space-y-2 shadow-sm lr-approval-pulse">
      <div className="text-xs font-semibold text-lr-warn">{approval.title}</div>
      <p className="text-xs text-lr-text whitespace-pre-wrap">{approval.detail}</p>
      <div className="flex flex-wrap gap-1.5">
        {approval.options.includes('allow_once') && (
          <button
            type="button"
            disabled={busy}
            className="px-2.5 py-1 text-xs rounded-md border border-lr-border bg-lr-panel hover:bg-lr-raised"
            onClick={() => onRespond('allow_once')}
          >
            Allow once
          </button>
        )}
        {approval.options.includes('allow_always') && (
          <button
            type="button"
            disabled={busy}
            className="px-2.5 py-1 text-xs rounded-md border border-lr-border bg-lr-panel hover:bg-lr-raised"
            onClick={() => onRespond('allow_always')}
          >
            Always allow
          </button>
        )}
        {approval.options.includes('deny') && (
          <button
            type="button"
            disabled={busy}
            className="px-2.5 py-1 text-xs rounded-md border border-lr-err/40 text-lr-err hover:bg-lr-err/10"
            onClick={() => onRespond('deny')}
          >
            Deny
          </button>
        )}
      </div>
    </div>
  );
}

export function AgentTimeline({
  vm,
  nativeTuiOnly,
  busy,
  onRespondApproval,
}: {
  vm: AgentTimelineViewModel;
  nativeTuiOnly: boolean;
  busy: boolean;
  onRespondApproval: (approvalId: string, decision: ApprovalDecision) => void;
}) {
  if (nativeTuiOnly) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-sm font-medium text-lr-text">This agent runs in native TUI mode</p>
          <p className="text-xs text-lr-muted">
            Use the terminal surface for this session. When a protocol adapter is connected, chat and
            approvals appear here automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-3 space-y-3 min-h-0">
      {vm.rateLimit && (
        <div className="text-xs rounded-lg border border-lr-info/40 bg-lr-info/10 p-2 text-lr-info">
          {vm.rateLimit.message}
        </div>
      )}
      {vm.lastError && (
        <div className="text-xs rounded-lg border border-lr-err/40 bg-lr-err/10 p-2 text-lr-err">
          {vm.lastError}
        </div>
      )}
      {vm.pendingApprovals.map((a) => (
        <ApprovalStrip
          key={a.id}
          approval={a}
          busy={busy}
          onRespond={(d) => onRespondApproval(a.id, d)}
        />
      ))}
      {vm.messages.map((message) => {
        const isUser = message.role === 'user';
        const text = message.text;
        if (!text) return null;
        return (
          <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[92%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-words border ${
                isUser
                  ? 'bg-lr-accent/10 border-lr-accent/25 text-lr-text'
                  : 'bg-lr-bg border-lr-border text-lr-text'
              }`}
            >
              {!isUser && (
                <div className="text-[10px] uppercase tracking-wide text-lr-muted mb-0.5">
                  Assistant{message.streaming ? ' · typing…' : ''}
                </div>
              )}
              {text}
            </div>
          </div>
        );
      })}
      {vm.tools.map((t) => (
        <ToolRow key={t.id} tool={t} />
      ))}
      {vm.filePaths.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {vm.filePaths.map((p) => (
            <span
              key={p}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-lr-border bg-lr-raised text-lr-muted"
            >
              {p}
            </span>
          ))}
        </div>
      )}
      {vm.usage && (
        <p className="text-[10px] text-lr-muted">
          tokens in {vm.usage.input_tokens ?? '—'} · out {vm.usage.output_tokens ?? '—'}
          {vm.usage.cost_usd != null && ` · $${vm.usage.cost_usd.toFixed(4)}`}
        </p>
      )}
    </div>
  );
}
