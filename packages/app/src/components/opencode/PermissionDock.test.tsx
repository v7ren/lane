import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import permissionAskedFixture from '../../lib/opencode/__fixtures__/permission-asked.json';
import { PermissionDock, type PermissionDockItem } from './PermissionDock';

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

function renderDock(
  props: Partial<{
    permissions: PermissionDockItem[];
    busy: boolean;
    lastRequestError: string | null;
    onReply: (id: string, reply: 'once' | 'always' | 'reject') => void;
  }> = {},
) {
  const onReply = props.onReply ?? vi.fn();
  const root = createRoot(container);
  act(() => {
    root.render(
      <PermissionDock
        permissions={props.permissions ?? []}
        busy={props.busy ?? false}
        lastRequestError={props.lastRequestError ?? null}
        onReply={onReply}
      />,
    );
  });
  return { root, onReply };
}

function fixtureFromPermissionAsked(): PermissionDockItem {
  const props = permissionAskedFixture.properties;
  return {
    id: props.id,
    permissionName: props.permission,
    patterns: [...props.patterns],
    always: [...props.always],
    receivedAt: 1,
  };
}

function clickTestId(id: string) {
  const btn = container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
  act(() => btn.click());
}

describe('PermissionDock', () => {
  it('renders permission-asked fixture with tool name and pattern', () => {
    renderDock({ permissions: [fixtureFromPermissionAsked()] });
    expect(container.textContent).toContain('bash');
    expect(container.textContent).toContain('echo hello');
    expect(container.textContent).not.toContain('"sessionID"');
    expect(container.textContent).not.toContain('"patterns"');
  });

  it('Allow once calls onReply with once', () => {
    const item = fixtureFromPermissionAsked();
    const { onReply, root } = renderDock({ permissions: [item] });
    clickTestId('permission-dock-allow-once');
    expect(onReply).toHaveBeenCalledWith(item.id, 'once');
    act(() => root.unmount());
  });

  it('Always allow calls onReply with always', () => {
    const item = fixtureFromPermissionAsked();
    const { onReply, root } = renderDock({ permissions: [item] });
    clickTestId('permission-dock-allow-always');
    expect(onReply).toHaveBeenCalledWith(item.id, 'always');
    act(() => root.unmount());
  });

  it('Reject calls onReply with reject', () => {
    const item = fixtureFromPermissionAsked();
    const { onReply, root } = renderDock({ permissions: [item] });
    clickTestId('permission-dock-reject');
    expect(onReply).toHaveBeenCalledWith(item.id, 'reject');
    act(() => root.unmount());
  });

  it('two pending shows 1 of 2 and only oldest', () => {
    const older: PermissionDockItem = {
      ...fixtureFromPermissionAsked(),
      id: 'req_old',
      patterns: ['first command'],
      receivedAt: 10,
    };
    const newer: PermissionDockItem = {
      ...fixtureFromPermissionAsked(),
      id: 'req_new',
      patterns: ['second command'],
      receivedAt: 20,
    };
    renderDock({ permissions: [newer, older] });
    expect(container.textContent).toContain('1 of 2');
    expect(container.textContent).toContain('first command');
    expect(container.textContent).not.toContain('second command');
  });

  it('submitting disables all three buttons', () => {
    renderDock({
      permissions: [{ ...fixtureFromPermissionAsked(), submitting: true }],
      busy: false,
    });
    const once = container.querySelector('[data-testid="permission-dock-allow-once"]') as HTMLButtonElement;
    const always = container.querySelector('[data-testid="permission-dock-allow-always"]') as HTMLButtonElement;
    const reject = container.querySelector('[data-testid="permission-dock-reject"]') as HTMLButtonElement;
    expect(once.disabled).toBe(true);
    expect(always.disabled).toBe(true);
    expect(reject.disabled).toBe(true);
  });

  it('lastRequestError renders in red', () => {
    renderDock({
      permissions: [fixtureFromPermissionAsked()],
      lastRequestError: 'Permission reply failed',
    });
    const err = container.querySelector('[data-testid="permission-dock-error"]');
    expect(err?.textContent).toBe('Permission reply failed');
    expect(err?.className).toContain('text-status-error');
  });

  it('non-empty always list rendered under Always allow', () => {
    renderDock({
      permissions: [
        {
          ...fixtureFromPermissionAsked(),
          always: ['bash', 'read'],
        },
      ],
    });
    const list = container.querySelector('[data-testid="permission-dock-always-list"]');
    expect(list?.textContent).toBe('bash, read');
  });
});
