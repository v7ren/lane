import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Plus, Square } from 'lucide-react';
import type { Capabilities } from '../../lib/agent-events';
import {
  abortOpenCodeSession,
  composerFeaturesForCapabilities,
  composerFeaturesOpenCode,
  searchMentionFiles,
  sendOpenCodePrompt,
  sendOpenCodeShell,
  sendOpenCodeSlashCommand,
  type ComposerMode,
  type PromptPart,
} from '../../lib/commands/agent';
import { useDemoFixtures } from '../../lib/demo/DemoContext';
import {
  demoComposerAgents,
  demoComposerCommands,
  demoComposerModels,
  demoMentionFiles,
} from '../../lib/demo/composer-fixtures';
import { composerAllowlistOk } from '../../lib/opencode/composer-allowlist';
import { opencodeClient } from '../../lib/opencode/client';
import { isTauriRuntime } from '../../lib/is-tauri';
import { ADD_TO_COMPOSER_EVENT, type AddToComposerDetail } from '../../lib/editor/add-to-composer';
import { useShellSelection } from '../../lib/shell-selection-context';

type ModelChoice = { providerID: string; modelID: string; label: string };

export function AgentComposerPanel({
  paneId,
  sessionId,
  openCode,
  capabilities,
  disabled,
  disabledReason,
  busy,
  showStop,
  onSendProtocol,
  onCancelProtocol,
  onError,
  sessionModel,
}: {
  paneId: string;
  sessionId: string | null;
  openCode: boolean;
  capabilities: Capabilities;
  disabled: boolean;
  disabledReason?: string;
  busy: boolean;
  showStop: boolean;
  sessionModel?: { model: string; provider?: string } | null;
  onSendProtocol: (text: string) => Promise<void>;
  onCancelProtocol: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const demo = useDemoFixtures();
  const shell = useShellSelection();
  const features = openCode ? composerFeaturesOpenCode() : composerFeaturesForCapabilities(capabilities);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<ComposerMode>('chat');
  const [agent, setAgent] = useState('build');
  const [permissionMode, setPermissionMode] = useState<'allow' | 'ask'>('allow');
  const [model, setModel] = useState<ModelChoice | null>(null);
  const [agents, setAgents] = useState<{ name: string; description?: string }[]>([]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [commands, setCommands] = useState<{ name: string; description?: string }[]>([]);
  const [picker, setPicker] = useState<'agent' | 'model' | 'permission' | 'mention' | 'slash' | null>(
    null,
  );
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionHits, setMentionHits] = useState<{ path: string }[]>([]);
  const [fileParts, setFileParts] = useState<PromptPart[]>([]);
  const historyRef = useRef<string[]>([]);
  const historyIdx = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [allowlistBlocked, setAllowlistBlocked] = useState(false);

  useEffect(() => {
    if (openCode && isTauriRuntime() && !composerAllowlistOk()) {
      setAllowlistBlocked(true);
    }
  }, [openCode]);

  useEffect(() => {
    const onAdd = (event: Event) => {
      const detail = (event as CustomEvent<AddToComposerDetail>).detail;
      if (!detail?.path) return;
      shell.setBottomTab('agent');
      const mention = `@${detail.path}`;
      const block = detail.selection?.trim()
        ? `\n\n"""${detail.selection.trim()}"""`
        : '';
      const insert = `${mention}${block}`;
      setDraft((prev) => (prev.trim() ? `${prev.trimEnd()}\n${insert}` : insert));
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    };
    window.addEventListener(ADD_TO_COMPOSER_EVENT, onAdd);
    return () => window.removeEventListener(ADD_TO_COMPOSER_EVENT, onAdd);
  }, [shell]);

  useEffect(() => {
    if (demo && openCode) {
      setAgents(demoComposerAgents.map((a) => ({ name: a.name })));
      setModels(demoComposerModels);
      setCommands(demoComposerCommands);
      const preferred =
        demoComposerModels.find((m) => m.modelID.includes('deepseek')) ?? demoComposerModels[0];
      if (preferred) setModel(preferred);
    }
  }, [demo, openCode]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 160;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [draft]);

  useEffect(() => {
    if (!openCode || demo) return;
    if (!isTauriRuntime()) return;
    void opencodeClient.listAgents(paneId).then((list) => {
      setAgents(
        list.map((a) => ({
          name: (a as { name?: string; id?: string }).name ?? (a as { id?: string }).id ?? 'build',
          description: (a as { description?: string }).description,
        })),
      );
      if (list[0]?.name) setAgent(list[0].name);
    });
    void opencodeClient.listProviders(paneId).then((providers) => {
      const choices: ModelChoice[] = [];
      const raw = providers as unknown;
      const list = Array.isArray(raw)
        ? (raw as { id: string; models?: { id: string }[] }[])
        : Object.values(raw as Record<string, { id: string; models?: { id: string }[] }>);
      for (const p of list) {
        for (const m of p.models ?? []) {
          choices.push({
            providerID: p.id,
            modelID: m.id,
            label: `${p.id}/${m.id}`,
          });
        }
      }
      setModels(choices);
      if (choices[0]) setModel(choices[0]);
    });
    void opencodeClient.listCommands(paneId).then((cmds) =>
      setCommands(cmds.map((c) => ({ name: c.name, description: c.description }))),
    );
  }, [openCode, paneId]);

  useEffect(() => {
    if (picker !== 'mention' || !openCode) return;
    const q = mentionQuery.trim();
    if (demo) {
      const hits = demoMentionFiles.filter((f) =>
        q.length < 1 ? true : f.path.toLowerCase().includes(q.toLowerCase()),
      );
      setMentionHits(hits);
      return;
    }
    if (q.length < 1) {
      setMentionHits([]);
      return;
    }
    const id = window.setTimeout(() => {
      void searchMentionFiles(paneId, q).then((hits) =>
        setMentionHits(hits.map((h) => ({ path: h.path }))),
      );
    }, 120);
    return () => window.clearTimeout(id);
  }, [demo, mentionQuery, openCode, paneId, picker]);

  const submit = useCallback(async () => {
    const raw = draft.trim();
    if (!raw || disabled || busy) return;
    onError(null);
    const parts: PromptPart[] = [...fileParts, { type: 'text', text: raw }];
    try {
      if (openCode && sessionId) {
        if (mode === 'shell' || raw.startsWith('!')) {
          const cmd = raw.startsWith('!') ? raw.slice(1).trim() : raw;
          await sendOpenCodeShell({ paneId, sessionId, command: cmd });
        } else if (raw.startsWith('/')) {
          const [name, ...rest] = raw.slice(1).split(/\s+/);
          await sendOpenCodeSlashCommand({
            paneId,
            sessionId,
            name: name ?? '',
            args: rest.join(' '),
          });
        } else {
          await sendOpenCodePrompt({
            paneId,
            sessionId,
            parts,
            agent,
            model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
          });
        }
      } else {
        await onSendProtocol(raw);
      }
      historyRef.current = [raw, ...historyRef.current.filter((h) => h !== raw)].slice(0, 50);
      historyIdx.current = null;
      setDraft('');
      setFileParts([]);
      setMode('chat');
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [
    agent,
    busy,
    disabled,
    draft,
    fileParts,
    mode,
    model,
    onError,
    onSendProtocol,
    openCode,
    paneId,
    sessionId,
  ]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === 'ArrowUp' && draft.length === 0 && historyRef.current.length > 0) {
      e.preventDefault();
      const idx = historyIdx.current ?? 0;
      historyIdx.current = Math.min(idx, historyRef.current.length - 1);
      setDraft(historyRef.current[historyIdx.current] ?? '');
    }
    if (e.key === '@') {
      setPicker('mention');
      setMentionQuery('');
    }
    if (e.key === '/') {
      setPicker('slash');
    }
  };

  const attachFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: PromptPart[] = [];
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      next.push({ type: 'file', mime: file.type || 'application/octet-stream', filename: file.name, url });
    }
    setFileParts((prev) => [...prev, ...next]);
  };

  const filteredModels = useMemo(() => models, [models]);

  const modelPillPrimary = model?.modelID ?? sessionModel?.model;
  const modelPillProvider = model?.providerID ?? sessionModel?.provider;
  const modelPillLabel = modelPillPrimary ?? 'Select model';

  return (
    <div className="border-t border-border-subtle bg-surface shrink-0" data-testid="agent-composer">
      <div className="px-3 pt-2">
        <span className="text-section-label text-text-3">Me</span>
      </div>
      {disabled && disabledReason && (
        <p className="text-meta text-text-3 px-3 pb-1">{disabledReason}</p>
      )}
      {allowlistBlocked && (
        <p className="text-meta text-status-error px-3 pb-1">
          Some composer actions are unavailable because the desktop proxy allowlist is missing routes.
        </p>
      )}
      <div className="px-3 pb-2">
        <div
          className="rounded-lg border border-border-subtle bg-canvas focus-within:ring-2 focus-within:ring-accent/50"
          title={focused ? '! for shell · / for commands · @ for files' : undefined}
        >
          <textarea
            ref={textareaRef}
            data-agent-composer
            rows={2}
            className="w-full bg-transparent px-3 py-2 text-body text-text resize-none min-h-[3rem] max-h-40 focus:outline-none overflow-y-auto"
            placeholder="Ask your agent…"
            value={draft}
            disabled={disabled || busy}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setDraft(e.target.value);
              const at = e.target.value.lastIndexOf('@');
              if (at >= 0) {
                setPicker('mention');
                setMentionQuery(e.target.value.slice(at + 1));
              }
            }}
            onKeyDown={onKeyDown}
          />
          <div className="flex items-center gap-2 px-2 pb-2 flex-wrap">
            {features.attach && (
              <label className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-border-subtle hover:bg-hover cursor-pointer">
                <Plus className="w-4 h-4 text-text-2" />
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*"
                  onChange={(e) => void attachFiles(e.target.files)}
                />
              </label>
            )}
            {features.agentPicker && (
              <Pill
                label={agent}
                open={picker === 'agent'}
                onClick={() => setPicker((p) => (p === 'agent' ? null : 'agent'))}
                testId="picker-agent"
              />
            )}
            {features.permissionPicker && (
              <Pill
                label={permissionMode === 'allow' ? 'Allow' : 'Ask'}
                open={picker === 'permission'}
                onClick={() => setPicker((p) => (p === 'permission' ? null : 'permission'))}
                testId="picker-permission"
              />
            )}
            <div className="flex-1" />
            {features.modelPicker && (
              <Pill
                label={modelPillLabel}
                sublabel={modelPillPrimary ? modelPillProvider : undefined}
                open={picker === 'model'}
                onClick={() => setPicker((p) => (p === 'model' ? null : 'model'))}
                testId="picker-model"
                wide
              />
            )}
            {showStop && features.stop ? (
              <button
                type="button"
                className="w-9 h-9 rounded-full border border-status-error/40 text-status-error flex items-center justify-center hover:bg-status-error/10"
                onClick={() => {
                  if (openCode && sessionId) void abortOpenCodeSession(paneId, sessionId);
                  else void onCancelProtocol();
                }}
                aria-label="Stop"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                disabled={disabled || busy || !draft.trim()}
                className="w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40"
                onClick={() => void submit()}
                aria-label="Send"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        {fileParts.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {fileParts.map((f, i) => (
              <span
                key={`${f.type}-${i}`}
                className="inline-flex items-center gap-1 text-meta px-2 py-0.5 rounded-full bg-elevated border border-border-subtle"
              >
                <Paperclip className="w-3 h-3" />
                {f.type === 'file' ? f.filename ?? 'file' : 'text'}
              </span>
            ))}
          </div>
        )}
        {picker === 'agent' && (
          <PopoverList
            items={agents.map((a) => ({ id: a.name, label: a.name, detail: a.description }))}
            onPick={(id) => {
              setAgent(id);
              setPicker(null);
            }}
          />
        )}
        {picker === 'model' && (
          <PopoverList
            items={filteredModels.map((m) => ({ id: m.label, label: m.label }))}
            onPick={(id) => {
              const hit = models.find((m) => m.label === id);
              if (hit) setModel(hit);
              setPicker(null);
            }}
            testId="model-popover"
          />
        )}
        {picker === 'permission' && (
          <PopoverList
            items={[
              { id: 'allow', label: 'Allow' },
              { id: 'ask', label: 'Ask' },
            ]}
            onPick={(id) => {
              setPermissionMode(id === 'ask' ? 'ask' : 'allow');
              setPicker(null);
            }}
          />
        )}
        {picker === 'mention' && (
          <PopoverList
            items={mentionHits.map((h) => ({ id: h.path, label: h.path }))}
            onPick={(id) => {
              setDraft((d) => `${d.replace(/@[^@]*$/, '')}@${id} `);
              setFileParts((prev) => [
                ...prev,
                { type: 'file', mime: 'text/plain', url: `file://${id}`, filename: id.split('/').pop() },
              ]);
              setPicker(null);
            }}
            testId="mention-popover"
          />
        )}
        {picker === 'slash' && (
          <PopoverList
            items={commands.map((c) => ({ id: c.name, label: `/${c.name}`, detail: c.description }))}
            onPick={(id) => {
              setDraft(`/${id} `);
              setPicker(null);
            }}
          />
        )}
        {focused && (
          <p className="text-[11px] text-text-3 mt-1 px-0.5">
            Enter send · Shift+Enter newline · ! for shell · / for commands · @ for files
            {openCode && (
              <>
                {' · '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setMode(mode === 'shell' ? 'chat' : 'shell')}
                >
                  {mode === 'shell' ? 'Shell mode on' : 'Shell mode off'}
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function Pill({
  label,
  sublabel,
  onClick,
  open,
  testId,
  wide,
}: {
  label: string;
  sublabel?: string;
  onClick: () => void;
  open: boolean;
  testId?: string;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      className={`h-8 px-3 rounded-full border border-border-subtle bg-elevated text-meta hover:bg-hover inline-flex items-center gap-1 min-w-0 ${
        wide ? 'max-w-[14rem]' : ''
      } ${open ? 'ring-2 ring-accent/40' : ''}`}
      onClick={onClick}
    >
      <span className={`truncate ${sublabel ? 'text-text' : 'text-text'}`}>{label}</span>
      {sublabel && <span className="truncate text-text-3">{sublabel}</span>}
    </button>
  );
}

function PopoverList({
  items,
  onPick,
  testId,
}: {
  items: { id: string; label: string; detail?: string }[];
  onPick: (id: string) => void;
  testId?: string;
}) {
  return (
    <div
      className="mt-2 max-h-40 overflow-auto rounded-lg border border-border-subtle bg-elevated shadow-lg"
      data-testid={testId}
    >
      {items.length === 0 && <p className="px-3 py-2 text-meta text-text-3">No matches</p>}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="w-full text-left px-3 py-2 hover:bg-hover text-body text-text"
          onClick={() => onPick(item.id)}
        >
          <div>{item.label}</div>
          {item.detail && <div className="text-meta text-text-3">{item.detail}</div>}
        </button>
      ))}
    </div>
  );
}
