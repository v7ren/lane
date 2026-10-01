import { useMemo, useRef, useState, type RefObject } from 'react';
import { AnchoredPopover } from '../shell/AnchoredPopover';
import { CLAUDE_PERMISSION_MODES, type ClaudeInfo } from '../../lib/claude-info';

type Picker = 'mode' | 'model' | 'commands' | null;

function BarButton({
  label,
  testId,
  open,
  onClick,
  buttonRef,
}: {
  label: string;
  testId: string;
  open: boolean;
  onClick: () => void;
  buttonRef: RefObject<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid={testId}
      className={`h-7 shrink-0 rounded-full border border-border-subtle bg-elevated px-3 text-meta text-text hover:bg-hover max-w-[10rem] truncate ${
        open ? 'ring-2 ring-accent/40' : ''
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function PickList({
  items,
  currentId,
  onPick,
  emptyMessage,
}: {
  items: { id: string; label: string; detail?: string }[];
  currentId?: string | null;
  onPick: (id: string) => void;
  emptyMessage: string;
}) {
  return (
    <div className="max-h-60 overflow-auto">
      {items.length === 0 && <p className="px-3 py-2 text-meta text-text-3">{emptyMessage}</p>}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`w-full text-left px-3 py-2 hover:bg-hover text-body text-text ${
            item.id === currentId ? 'bg-hover' : ''
          }`}
          onClick={() => onPick(item.id)}
        >
          <div>{item.label}</div>
          {item.detail && <div className="text-meta text-text-3 line-clamp-2">{item.detail}</div>}
        </button>
      ))}
    </div>
  );
}

/** Model, permission mode and slash commands for a Claude chat, read from Claude itself. */
export function ClaudeControlBar({
  info,
  onSetMode,
  onSetModel,
  onPickCommand,
}: {
  info: ClaudeInfo | null;
  onSetMode: (mode: string) => void;
  onSetModel: (model: string) => void;
  onPickCommand: (name: string) => void;
}) {
  const [picker, setPicker] = useState<Picker>(null);
  const modeRef = useRef<HTMLButtonElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const commandsRef = useRef<HTMLButtonElement>(null);
  const [commandSearch, setCommandSearch] = useState('');

  const close = () => {
    setPicker(null);
    setCommandSearch('');
  };
  const toggle = (next: Exclude<Picker, null>) => setPicker((current) => (current === next ? null : next));

  const modeLabel = CLAUDE_PERMISSION_MODES.find((m) => m.id === info?.permissionMode)?.label ?? 'Ask';
  const currentModel = info?.models.find((m) => m.value === (info.model ?? 'default'));
  const modelLabel = currentModel?.displayName ?? 'Default';

  const commandItems = useMemo(() => {
    const query = commandSearch.trim().toLowerCase();
    return (info?.commands ?? [])
      .filter((c) => !query || c.name.toLowerCase().includes(query))
      .slice(0, 80)
      .map((c) => ({
        id: c.name,
        label: `/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ''}`,
        detail: c.description,
      }));
  }, [commandSearch, info?.commands]);

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 pt-2 flex-wrap" data-testid="claude-control-bar">
      <BarButton
        label={modeLabel}
        testId="claude-mode"
        open={picker === 'mode'}
        onClick={() => toggle('mode')}
        buttonRef={modeRef}
      />
      <BarButton
        label={modelLabel}
        testId="claude-model"
        open={picker === 'model'}
        onClick={() => toggle('model')}
        buttonRef={modelRef}
      />
      <BarButton
        label="/ Commands"
        testId="claude-commands"
        open={picker === 'commands'}
        onClick={() => toggle('commands')}
        buttonRef={commandsRef}
      />
      {info?.account && <span className="text-meta text-text-3 ml-auto">{info.account}</span>}

      <AnchoredPopover open={picker === 'mode'} anchorRef={modeRef} onClose={close} testId="claude-mode-popover">
        <PickList
          items={CLAUDE_PERMISSION_MODES.map((m) => ({ id: m.id, label: m.label, detail: m.detail }))}
          currentId={info?.permissionMode}
          emptyMessage="No modes"
          onPick={(id) => {
            onSetMode(id);
            close();
          }}
        />
      </AnchoredPopover>
      <AnchoredPopover open={picker === 'model'} anchorRef={modelRef} onClose={close} testId="claude-model-popover">
        <PickList
          items={(info?.models ?? []).map((m) => ({ id: m.value, label: m.displayName, detail: m.description }))}
          currentId={info?.model ?? 'default'}
          emptyMessage="Models load when Claude has started"
          onPick={(id) => {
            onSetModel(id);
            close();
          }}
        />
      </AnchoredPopover>
      <AnchoredPopover
        open={picker === 'commands'}
        anchorRef={commandsRef}
        onClose={close}
        testId="claude-commands-popover"
        minWidth={280}
      >
        <div className="px-2 pt-2 pb-1 border-b border-border-subtle">
          <input
            type="search"
            className="w-full px-2 py-1 text-body bg-canvas border border-border-subtle rounded-md focus:outline-none focus:ring-1 focus:ring-accent/40"
            placeholder="Search commands and skills"
            value={commandSearch}
            onChange={(e) => setCommandSearch(e.target.value)}
            data-testid="claude-commands-search"
          />
        </div>
        <PickList
          items={commandItems}
          emptyMessage={info ? 'No matches' : 'Commands load when Claude has started'}
          onPick={(id) => {
            onPickCommand(id);
            close();
          }}
        />
      </AnchoredPopover>
    </div>
  );
}
