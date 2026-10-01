import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentMark } from './AgentMark';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('AgentMark', () => {
  it('renders Claude mark with C letter and coral color', () => {
    act(() => root.render(<AgentMark family="claude" size="md" />));
    const mark = host.querySelector('span');
    expect(mark?.textContent).toBe('C');
    expect(mark?.style.backgroundColor).toBe('rgb(217, 119, 87)'); // #D97757 in rgb
    expect(mark?.getAttribute('aria-label')).toBe('Claude');
  });

  it('renders Codex mark with X letter and purple color', () => {
    act(() => root.render(<AgentMark family="codex" size="md" />));
    const mark = host.querySelector('span');
    expect(mark?.textContent).toBe('X');
    expect(mark?.style.backgroundColor).toBe('rgb(139, 92, 246)'); // #8B5CF6 in rgb
    expect(mark?.getAttribute('aria-label')).toBe('Codex');
  });

  it('renders OpenCode mark with O letter and blue color', () => {
    act(() => root.render(<AgentMark family="opencode" size="md" />));
    const mark = host.querySelector('span');
    expect(mark?.textContent).toBe('O');
    expect(mark?.style.backgroundColor).toBe('rgb(59, 130, 246)'); // #3B82F6 in rgb
    expect(mark?.getAttribute('aria-label')).toBe('Opencode');
  });

  it('renders other mark with dot and gray color', () => {
    act(() => root.render(<AgentMark family="other" size="md" />));
    const mark = host.querySelector('span');
    expect(mark?.textContent).toBe('·');
    expect(mark?.style.backgroundColor).toBe('rgb(153, 153, 153)'); // #999999 in rgb
    expect(mark?.getAttribute('aria-label')).toBe('Other');
  });

  it('renders with small size classes', () => {
    act(() => root.render(<AgentMark family="claude" size="sm" />));
    const mark = host.querySelector('span');
    const classList = Array.from(mark?.classList ?? []);
    expect(classList).toContain('w-3.5');
    expect(classList).toContain('h-3.5');
    expect(classList).toContain('text-[9px]');
  });

  it('renders with default medium size', () => {
    act(() => root.render(<AgentMark family="claude" />));
    const mark = host.querySelector('span');
    const classList = Array.from(mark?.classList ?? []);
    expect(classList).toContain('w-5');
    expect(classList).toContain('h-5');
    expect(classList).toContain('text-[11px]');
  });
});
