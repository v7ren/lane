import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { AnchoredPopover } from '../shell/AnchoredPopover';
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
import { createPromptMessageId } from '../../lib/opencode/prompt-send';
import { fetchProviderCatalog, opencodeClient } from '../../lib/opencode/client';
import {
  buildComposerModelChoices,
  filterComposerModelChoices,
  pickDefaultComposerModel,
  resolveConfigModelPillLabel,
  type ComposerModelChoice,
} from '../../lib/opencode/provider-catalog';
import {
  getUserPickedSessionModel,
  setSessionComposerModel,
} from '../../lib/opencode/session-model-prefs';
import { isTauriRuntime } from '../../lib/is-tauri';
import { ADD_TO_COMPOSER_EVENT, type AddToComposerDetail } from '../../lib/editor/add-to-composer';
import { useShellSelection } from '../../lib/shell-selection-context';

function modelChoiceId(m: ComposerModelChoice): string {
  return `${m.providerID}:${m.modelID}`;
}

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
  const [model, setModel] = useState<ComposerModelChoice | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [agents, setAgents] = useState<{ name: string; description?: string }[]>([]);
  const [models, setModels] = useState<ComposerModelChoice[]>([]);
  const [commands, setCommands] = useState<{ name: string; description?: string }[]>([]);
  const [picker, setPicker] = useState<'agent' | 'model' | 'permission' | 'mention' | 'slash' | null>(
    null,
  );
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionHits, setMentionHits] = useState<{ path: string }[]>([]);
  const [fileParts, setFileParts] = useState<PromptPart[]>([]);
  const historyRef = useRef<string[]>([]);
  const historyIdx = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const agentPickerRef = useRef<HTMLButtonElement | null>(null);
  const modelPickerRef = useRef<HTMLButtonElement | null>(null);
  const permissionPickerRef = useRef<HTMLButtonElement | null>(null);
  const mentionPickerRef = useRef<HTMLElement | null>(null);
  const slashPickerRef = useRef<HTMLElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarCompact, setToolbarCompact] = useState(false);
  const [focused, setFocused] = useState(false);
  const [allowlistBlocked, setAllowlistBlocked] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [configPillLabel, setConfigPillLabel] = useState<string | null>(null);
  const sendInFlightRef = useRef(false);

  useEffect(() => {
    if (openCode && isTauriRuntime() && !composerAllowlistOk()) {
      setAllowlistBlocked(true);
    }
  }, [openCode]);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setToolbarCompact(el.clientWidth < 420);
    });
    ro.observe(el);
    setToolbarCompact(el.clientWidth < 420);
    return () => ro.disconnect();
  }, []);

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
      const demoModels: ComposerModelChoice[] = demoComposerModels.map((m) => ({
        providerID: m.providerID,
        modelID: m.modelID,
        label: m.label,
        providerName: m.providerID,
        modelName: m.modelID,
        connected: true,
        isCurrent: false,
      }));
      setModels(demoModels);
      setCommands(demoComposerCommands);
      const preferred =
        demoModels.find((m) => m.modelID.includes('deepseek')) ?? demoModels[0];
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
    setCatalogError(null);
    void opencodeClient
      .listAgents(paneId)
      .then((list) => {
        setAgents(
          list.map((a) => ({
            name: (a as { name?: string; id?: string }).name ?? (a as { id?: string }).id ?? 'build',
            description: (a as { description?: string }).description,
          })),
        );
        if (list[0]?.name) setAgent(list[0].name);
      })
      .catch((err) => {
        setCatalogError(err instanceof Error ? err.message : String(err));
      });
    setModelsLoading(true);
    setModelsError(null);
    void Promise.all([fetchProviderCatalog(paneId), opencodeClient.getConfig(paneId)])
      .then(([raw, config]) => {
        setConfigPillLabel(resolveConfigModelPillLabel(config));
        const userPicked =
          sessionId != null ? getUserPickedSessionModel(paneId, sessionId) : null;
        const hint =
          userPicked ??
          (sessionModel?.model
            ? {
                providerID: sessionModel.provider ?? 'opencode-go',
                modelID: sessionModel.model,
              }
            : null);
        const choices = buildComposerModelChoices(raw, { current: hint });
        setModels(choices);
        if (hint) {
          const picked = pickDefaultComposerModel(raw, choices, hint);
          if (picked) setModel(picked);
        } else {
          setModel(null);
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setModelsError(message);
        setCatalogError((prev) => prev ?? message);
      })
      .finally(() => setModelsLoading(false));
    void opencodeClient.listCommands(paneId).then((cmds) =>
      setCommands(cmds.map((c) => ({ name: c.name, description: c.description }))),
    );
  }, [demo, openCode, paneId, sessionId, sessionModel?.model, sessionModel?.provider]);

  useEffect(() => {
    if (!openCode || demo || !sessionId || models.length === 0) return;
    const stored = getUserPickedSessionModel(paneId, sessionId);
    if (stored) {
      const hit = models.find(
        (m) => m.providerID === stored.providerID && m.modelID === stored.modelID,
      );
      if (hit) setModel(hit);
    }
  }, [demo, models, openCode, paneId, sessionId]);

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
    if (!raw || disabled || busy || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    onError(null);
    const parts: PromptPart[] = [...fileParts, { type: 'text', text: raw }];
    const messageId = createPromptMessageId();
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
          const explicit =
            sessionId != null ? getUserPickedSessionModel(paneId, sessionId) : null;
          await sendOpenCodePrompt({
            paneId,
            sessionId,
            messageId,
            parts,
            agent,
            model: explicit
              ? { providerID: explicit.providerID, modelID: explicit.modelID }
              : undefined,
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
    } finally {
      sendInFlightRef.current = false;
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

  const filteredModels = useMemo(
    () => filterComposerModelChoices(models, modelSearch),
    [modelSearch, models],
  );

  const userPickedModel =
    sessionId != null ? getUserPickedSessionModel(paneId, sessionId) : null;
  const hasExplicitModel = Boolean(userPickedModel || sessionModel?.model || model);
  const modelPillPrimary = userPickedModel?.modelID ?? model?.modelID ?? sessionModel?.model;
  const modelPillProvider = hasExplicitModel
    ? userPickedModel?.providerID ?? model?.providerID ?? sessionModel?.provider
    : undefined;
  const modelPillLabel = modelsError
    ? 'Model error'
    : hasExplicitModel
      ? (model?.modelName ?? modelPillPrimary ?? 'Select model')
      : (configPillLabel ?? 'Default');

  const modelPickerEmptyMessage = modelsLoading
    ? 'Loading models…'
    : modelsError
      ? modelsError
      : models.length === 0
        ? 'No models available'
        : 'No matches';

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
      {catalogError && (
        <p className="text-meta text-status-error px-3 pb-1" data-testid="composer-catalog-error">
          Agent/model catalog failed: {catalogError}
        </p>
      )}
      <div className="px-3 pb-2">
        <div
          className="rounded-lg border border-border-subtle bg-canvas focus-within:ring-2 focus-within:ring-accent/50"
          title={focused ? '! for shell · / for commands · @ for files' : undefined}
        >
          <textarea
            ref={(el) => {
              textareaRef.current = el;
              mentionPickerRef.current = el;
              slashPickerRef.current = el;
            }}
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
          <div
            ref={toolbarRef}
            className="flex items-center gap-2 px-2 pb-2 flex-nowrap min-w-0"
          >
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
                ref={agentPickerRef}
                label={catalogError ? 'Agent error' : agent}
                open={picker === 'agent'}
                onClick={() => setPicker((p) => (p === 'agent' ? null : 'agent'))}
                testId="picker-agent"
                error={Boolean(catalogError)}
                iconOnly={toolbarCompact}
              />
            )}
            {features.permissionPicker && (
              <Pill
                ref={permissionPickerRef}
                label={permissionMode === 'allow' ? 'Allow' : 'Ask'}
                open={picker === 'permission'}
                onClick={() => setPicker((p) => (p === 'permission' ? null : 'permission'))}
                testId="picker-permission"
                iconOnly={toolbarCompact}
              />
            )}
            <div className="flex-1 min-w-0" />
            {features.modelPicker && (
              <Pill
                ref={modelPickerRef}
                label={modelsError ? 'Model error' : modelPillLabel}
                sublabel={
                  toolbarCompact || modelsError || !hasExplicitModel
                    ? undefined
                    : modelPillPrimary
                      ? modelPillProvider
                      : undefined
                }
                open={picker === 'model'}
                onClick={() => {
                  setPicker((p) => {
                    const next = p === 'model' ? null : 'model';
                    if (next !== 'model') setModelSearch('');
                    return next;
                  });
                }}
                testId="picker-model"
                wide
                error={Boolean(modelsError)}
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
                className="w-9 h-9 shrink-0 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40"
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
        <PickerPopover
          open={picker === 'agent'}
          anchorRef={agentPickerRef}
          onClose={() => setPicker(null)}
          items={agents.map((a) => ({ id: a.name, label: a.name, detail: a.description }))}
          onPick={(id) => {
            setAgent(id);
            setPicker(null);
          }}
        />
        <PickerPopover
          open={picker === 'model'}
          anchorRef={modelPickerRef}
          onClose={() => {
            setPicker(null);
            setModelSearch('');
          }}
          testId="model-popover"
          searchQuery={modelSearch}
          onSearchChange={setModelSearch}
          searchPlaceholder="Search models…"
          emptyMessage={modelPickerEmptyMessage}
          emptyIsError={Boolean(modelsError)}
          items={filteredModels.map((m) => ({
            id: modelChoiceId(m),
            label: m.modelName,
            detail: `${m.providerName}${m.isCurrent ? ' · current' : ''}${m.connected ? '' : ' · offline'}`,
          }))}
          onPick={(id) => {
            const hit = models.find((m) => modelChoiceId(m) === id);
            if (hit) {
              setModel(hit);
              if (sessionId) {
                setSessionComposerModel(paneId, sessionId, {
                  providerID: hit.providerID,
                  modelID: hit.modelID,
                });
              }
            }
            setPicker(null);
            setModelSearch('');
          }}
        />
        <PickerPopover
          open={picker === 'permission'}
          anchorRef={permissionPickerRef}
          onClose={() => setPicker(null)}
          items={[
            { id: 'allow', label: 'Allow' },
            { id: 'ask', label: 'Ask' },
          ]}
          onPick={(id) => {
            setPermissionMode(id === 'ask' ? 'ask' : 'allow');
            setPicker(null);
          }}
        />
        <PickerPopover
          open={picker === 'mention'}
          anchorRef={mentionPickerRef}
          onClose={() => setPicker(null)}
          testId="mention-popover"
          items={mentionHits.map((h) => ({ id: h.path, label: h.path }))}
          onPick={(id) => {
            setDraft((d) => `${d.replace(/@[^@]*$/, '')}@${id} `);
            setFileParts((prev) => [
              ...prev,
              { type: 'file', mime: 'text/plain', url: `file://${id}`, filename: id.split('/').pop() },
            ]);
            setPicker(null);
          }}
        />
        <PickerPopover
          open={picker === 'slash'}
          anchorRef={slashPickerRef}
          onClose={() => setPicker(null)}
          items={commands.map((c) => ({ id: c.name, label: `/${c.name}`, detail: c.description }))}
          onPick={(id) => {
            setDraft(`/${id} `);
            setPicker(null);
          }}
        />
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

const Pill = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    sublabel?: string;
    onClick: () => void;
    open: boolean;
    testId?: string;
    wide?: boolean;
    error?: boolean;
    iconOnly?: boolean;
  }
>(function Pill({ label, sublabel, onClick, open, testId, wide, error, iconOnly }, ref) {
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      title={iconOnly ? label : undefined}
      className={`h-8 shrink-0 rounded-full border bg-elevated text-meta hover:bg-hover inline-flex items-center gap-1 min-w-0 ${
        iconOnly ? 'w-8 px-0 justify-center' : 'px-3'
      } ${
        error ? 'border-status-error/60 text-status-error' : 'border-border-subtle'
      } ${wide && !iconOnly ? 'max-w-[9rem]' : ''} ${open ? 'ring-2 ring-accent/40' : ''}`}
      onClick={onClick}
    >
      {iconOnly ? (
        <span className="text-[11px] font-semibold">{initial}</span>
      ) : (
        <>
          <span className="truncate text-text">{label}</span>
          {sublabel && <span className="truncate text-text-3 max-w-[5rem]">{sublabel}</span>}
        </>
      )}
    </button>
  );
});

function PickerPopover({
  open,
  anchorRef,
  onClose,
  items,
  onPick,
  testId,
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  emptyMessage = 'No matches',
  emptyIsError = false,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  items: { id: string; label: string; detail?: string }[];
  onPick: (id: string) => void;
  testId?: string;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
  emptyIsError?: boolean;
}) {
  return (
    <AnchoredPopover open={open} anchorRef={anchorRef} onClose={onClose} testId={testId}>
      {onSearchChange && (
        <div className="px-2 pt-2 pb-1 border-b border-border-subtle">
          <input
            type="search"
            className="w-full px-2 py-1 text-body bg-canvas border border-border-subtle rounded-md focus:outline-none focus:ring-1 focus:ring-accent/40"
            placeholder={searchPlaceholder ?? 'Search…'}
            value={searchQuery ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            data-testid={testId ? `${testId}-search` : undefined}
          />
        </div>
      )}
      <div className="max-h-40 overflow-auto">
        {items.length === 0 && (
          <p
            className={`px-3 py-2 text-meta ${emptyIsError ? 'text-status-error' : 'text-text-3'}`}
          >
            {emptyMessage}
          </p>
        )}
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
    </AnchoredPopover>
  );
}
