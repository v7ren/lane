import { describe, expect, it } from 'vitest';
import {
  CLAUDE_TUI_ONLY,
  buildCommandList,
  parseSlashInput,
  resolveSubmit,
} from './command-model';
import {
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  OPENCODE_CAPABILITIES,
} from '../agent-capabilities';

describe('parseSlashInput', () => {
  it('parses name and args', () => {
    expect(parseSlashInput('/')).toEqual({ name: '', args: '' });
    expect(parseSlashInput('/model opus')).toEqual({ name: 'model', args: 'opus' });
    expect(parseSlashInput('/x  a b ')).toEqual({ name: 'x', args: 'a b' });
  });
  it('returns null for non-commands', () => {
    expect(parseSlashInput('//x')).toBeNull();
    expect(parseSlashInput('a /b')).toBeNull();
    expect(parseSlashInput('')).toBeNull();
  });
});

describe('buildCommandList', () => {
  const claude = buildCommandList({
    family: 'claude',
    caps: CLAUDE_CAPABILITIES.commands,
    agentCommands: [
      { name: 'compact', description: 'agent compact' },
      { name: 'cost' },
      { name: 'doctor' },
      { name: 'review', description: 'Review', argumentHint: '[pr]' },
      { name: 'review' },
    ],
  });

  it('puts Loomria actions first and lets them win', () => {
    expect(claude[0]?.source).toBe('loomria');
    expect(claude.find((c) => c.name === 'cost')?.source).toBe('loomria');
    expect(claude.find((c) => c.name === 'compact')?.source).toBe('agent');
    expect(claude.find((c) => c.name === 'model')?.choices).toBe('model');
    expect(claude.find((c) => c.name === 'resume')?.choices).toBe('past_chats');
  });
  it('drops an agent command named like an enabled action', () => {
    const list = buildCommandList({
      family: 'claude',
      caps: { ...CLAUDE_CAPABILITIES.commands, actions: ['compact', 'cost'] },
      agentCommands: [{ name: 'compact' }, { name: 'cost' }],
    });
    expect(list.map((c) => c.id)).toEqual(['loomria:compact', 'loomria:cost']);
  });
  it('marks TUI-only built-ins as terminal and the rest as prompt', () => {
    expect(claude.find((c) => c.name === 'doctor')).toMatchObject({
      kind: 'terminal',
      run: { type: 'terminal' },
    });
    expect(claude.find((c) => c.name === 'review')).toMatchObject({
      kind: 'prompt',
      run: { type: 'send' },
      argumentHint: '[pr]',
    });
    expect(CLAUDE_TUI_ONLY).toContain('doctor');
  });
  it('first duplicate agent command wins', () => {
    expect(claude.filter((c) => c.name === 'review')).toHaveLength(1);
  });
  it('hides terminal rows without terminalFallback', () => {
    const list = buildCommandList({
      family: 'claude',
      caps: { ...CLAUDE_CAPABILITIES.commands, terminalFallback: false },
      agentCommands: [{ name: 'doctor' }, { name: 'init' }],
    });
    expect(list.some((c) => c.kind === 'terminal')).toBe(false);
    expect(list.some((c) => c.name === 'init')).toBe(true);
  });
  it('OpenCode has no terminal rows when terminalFallback is false', () => {
    const list = buildCommandList({
      family: 'opencode',
      caps: { ...OPENCODE_CAPABILITIES.commands, terminalFallback: false },
      agentCommands: [{ name: 'doctor' }, { name: 'init' }],
    });
    expect(list.some((c) => c.kind === 'terminal')).toBe(false);
    expect(list.find((c) => c.name === 'doctor')?.kind).toBe('prompt');
  });
  it('hides agent prompt commands when caps.prompt is false (Codex)', () => {
    const list = buildCommandList({
      family: 'codex',
      caps: CODEX_CAPABILITIES.commands,
      agentCommands: [{ name: 'skill-x' }],
    });
    expect(list.some((c) => c.source === 'agent')).toBe(false);
    expect(list.some((c) => c.name === 'model')).toBe(true);
  });
});

describe('resolveSubmit', () => {
  const commands = buildCommandList({
    family: 'claude',
    caps: CLAUDE_CAPABILITIES.commands,
    agentCommands: [{ name: 'doctor' }, { name: 'review' }],
  });
  it('plain text and escaped slash', () => {
    expect(resolveSubmit('hello', commands)).toEqual({ kind: 'plain', text: 'hello' });
    expect(resolveSubmit('a /b', commands)).toEqual({ kind: 'plain', text: 'a /b' });
    expect(resolveSubmit('//x', commands)).toEqual({ kind: 'plain', text: '/x' });
  });
  it('unknown command', () => {
    expect(resolveSubmit('/unknownzz', commands)).toEqual({ kind: 'unknown', name: 'unknownzz' });
    expect(resolveSubmit('/', commands)).toEqual({ kind: 'unknown', name: '' });
  });
  it('resolves commands with args', () => {
    const r = resolveSubmit('/model opus', commands);
    expect(r.kind).toBe('command');
    if (r.kind === 'command') {
      expect(r.args).toBe('opus');
      expect(r.command.run).toEqual({ type: 'action', action: 'model' });
    }
    const t = resolveSubmit('/doctor', commands);
    expect(t.kind === 'command' && t.command.kind).toBe('terminal');
  });
});
