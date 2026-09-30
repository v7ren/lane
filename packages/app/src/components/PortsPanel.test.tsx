import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PORT_CONFIG, tauri, type PortsReport } from '../lib/tauri';
import { PortsPanel, validatePortConfig } from './PortsPanel';

const report: PortsReport = {
  config: DEFAULT_PORT_CONFIG,
  entries: [
    {
      role: 'bridge',
      port: 17321,
      pane_id: null,
      pid: 10,
      listening: true,
      owner: { pid: 10, name: 'loomria_app.exe' },
    },
  ],
  foreign_in_range: [{ port: 4096, owner: { pid: 77, name: 'node.exe' } }],
};

describe('validatePortConfig', () => {
  it('accepts the defaults', () => {
    expect(validatePortConfig(DEFAULT_PORT_CONFIG)).toBeNull();
  });

  it('rejects inverted, low, non-integer and overlapping ranges', () => {
    expect(validatePortConfig({ ...DEFAULT_PORT_CONFIG, agent_min: 5000, agent_max: 4000 })).toMatch(
      /above its end/,
    );
    expect(validatePortConfig({ ...DEFAULT_PORT_CONFIG, agent_min: 80 })).toMatch(/between/);
    expect(validatePortConfig({ ...DEFAULT_PORT_CONFIG, bridge_max: 70000 })).toMatch(/between/);
    expect(validatePortConfig({ ...DEFAULT_PORT_CONFIG, agent_min: 4096.5 })).toMatch(/whole/);
    expect(
      validatePortConfig({ ...DEFAULT_PORT_CONFIG, bridge_min: 4150, bridge_max: 4300 }),
    ).toMatch(/overlap/);
  });
});

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(open: boolean) {
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(<PortsPanel open={open} onClose={() => {}} />);
  });
}

function setInput(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`missing input ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function saveButton(): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save');
  if (!btn) throw new Error('missing Save button');
  return btn;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(tauri, 'portsReport').mockResolvedValue(report);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) {
    const mounted = root;
    act(() => mounted.unmount());
    root = null;
  }
  container.remove();
});

describe('PortsPanel', () => {
  it('renders nothing when closed', async () => {
    await mount(false);
    expect(container.innerHTML).toBe('');
  });

  it('lists Loomria ports and foreign holders', async () => {
    await mount(true);
    expect(container.textContent).toContain('17321');
    expect(container.textContent).toContain('loomria_app.exe (pid 10)');
    expect(container.querySelector('[data-testid="ports-foreign"]')?.textContent).toContain(
      'node.exe (pid 77)',
    );
  });

  it('saves a changed range and blocks an invalid one', async () => {
    const setConfig = vi.spyOn(tauri, 'portsSetConfig').mockImplementation(async (cfg) => cfg);
    await mount(true);
    expect(saveButton().disabled).toBe(true);

    setInput('agent_min', '5000');
    setInput('agent_max', '5099');
    expect(saveButton().disabled).toBe(false);
    await act(async () => saveButton().click());
    expect(setConfig).toHaveBeenCalledWith({
      ...DEFAULT_PORT_CONFIG,
      agent_min: 5000,
      agent_max: 5099,
    });

    setInput('agent_min', '80');
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/between/);
    expect(saveButton().disabled).toBe(true);
  });
});
