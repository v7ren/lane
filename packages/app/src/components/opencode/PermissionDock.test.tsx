import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import permissionAskedFixture from '../../lib/opencode/__fixtures__/permission-asked.json';
import { buildPermissionDockItems, PermissionDock, type PermissionDockItem } from './PermissionDock';
import type { ApprovalDecision } from '../../lib/agent-events';
import {
  parsePermissionFromProperties,
  pendingPermissionSessionId,
  type PendingPermission,
} from '../../lib/opencode/pending-requests';

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

function pendingFromFixture(): PendingPermission {
  const parsed = parsePermissionFromProperties(
    permissionAskedFixture.properties as Record<string, unknown>,
  );
  if (!parsed) throw new Error('permission-asked fixture did not parse');
  return { ...parsed, receivedAt: 1 };
}

const protocolOptions: ApprovalDecision[] = ['allow_once', 'allow_always', 'deny'];

describe('buildPermissionDockItems', () => {
  it('maps OpenCode store pending permission to dock item', () => {
    const pending = pendingFromFixture();
    const items = buildPermissionDockItems({
      isOpenCodePane: true,
      sessionId: pendingPermissionSessionId(pending) ?? null,
      pendingPermissions: [pending],
      pendingProtocolApprovals: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].permissionName).toBe('bash');
    expect(items[0].patterns).toEqual(['echo hello']);
  });

  it('returns no items for OpenCode when store empty but protocol has leftover approval', () => {
    const items = buildPermissionDockItems({
      isOpenCodePane: true,
      sessionId: 'sess_demo_001',
      pendingPermissions: [],
      pendingProtocolApprovals: [
        {
          id: 'per_0f096faad0016VkxpDfFib9njK',
          title: 'Permission required',
          detail: 'per_0f096faad0016VkxpDfFib9njK',
          kind: 'other',
          options: protocolOptions,
        },
      ],
    });
    expect(items).toHaveLength(0);
  });

  it('maps protocol pending approvals when not OpenCode pane', () => {
    const items = buildPermissionDockItems({
      isOpenCodePane: false,
      sessionId: null,
      pendingPermissions: [],
      pendingProtocolApprovals: [
        {
          id: 'approval-1',
          title: 'Run command',
          detail: 'npm test',
          kind: 'command',
          options: protocolOptions,
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].permissionName).toBe('Run command');
    expect(items[0].patterns).toEqual(['npm test']);
  });

  it('sets alwaysCaption only for Claude family', () => {
    const items = buildPermissionDockItems({
      isOpenCodePane: false,
      sessionId: null,
      pendingPermissions: [],
      pendingProtocolApprovals: [
        {
          id: 'approval-1',
          title: 'Run command',
          detail: 'npm test',
          kind: 'command',
          options: protocolOptions,
        },
      ],
      family: 'claude',
    });
    expect(items).toHaveLength(1);
    expect(items[0].alwaysCaption).toBe('Saved to .claude/settings.local.json in this project');
  });

  it('does not set alwaysCaption for non-Claude families', () => {
    const items = buildPermissionDockItems({
      isOpenCodePane: false,
      sessionId: null,
      pendingPermissions: [],
      pendingProtocolApprovals: [
        {
          id: 'approval-1',
          title: 'Run command',
          detail: 'npm test',
          kind: 'command',
          options: protocolOptions,
        },
      ],
      family: 'codex',
    });
    expect(items).toHaveLength(1);
    expect(items[0].alwaysCaption).toBeUndefined();
  });
});

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

  it('alwaysCaption rendered under Always allow for Claude', () => {
    renderDock({
      permissions: [
        {
          ...fixtureFromPermissionAsked(),
          alwaysCaption: 'Saved to .claude/settings.local.json in this project',
        },
      ],
    });
    const caption = container.querySelector('[data-testid="permission-dock-always-caption"]');
    expect(caption?.textContent).toBe('Saved to .claude/settings.local.json in this project');
  });

  it('alwaysCaption shown instead of always list when both present', () => {
    renderDock({
      permissions: [
        {
          ...fixtureFromPermissionAsked(),
          always: ['bash', 'read'],
          alwaysCaption: 'Saved to .claude/settings.local.json in this project',
        },
      ],
    });
    const caption = container.querySelector('[data-testid="permission-dock-always-caption"]');
    const list = container.querySelector('[data-testid="permission-dock-always-list"]');
    expect(caption?.textContent).toBe('Saved to .claude/settings.local.json in this project');
    expect(list).toBeNull();
  });
});
