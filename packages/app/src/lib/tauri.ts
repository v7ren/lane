import type { AgentCatalog } from '@loomria/shared';
import type { OpenCodePermission, SessionMessagesView } from './opencode-chat';
import { emptyAgentCatalog } from '@loomria/shared';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, LogicalSize, type CloseRequestedEvent } from '@tauri-apps/api/window';
export type AgentModelInspection = {
  pane_id: string;
  agent_type: string;
  buffer_tail: string;
};

export interface BridgeSessionInfo {
  base_url: string;
  token: string;
}

export type PaneInfo = {
  id: string;
  agent_type: string;
  pid: number;
  status: 'running' | 'waiting_input' | 'idle' | 'error';
  created_at: number;
  last_output_at: number | null;
  cwd: string;
  cols: number;
  rows: number;
  surface?: string;
};

export type ClaudePastSession = { id: string; title: string; updated_at: number };

export type TerminalSnapshotEvent = { pane_id: string; snapshot: string };
export type TerminalDataEvent = { pane_id: string; data: number[] };
export type PaneStatusEvent = { pane_id: string; status: PaneInfo['status'] };
export type PaneExitEvent = { pane_id: string };
export type PanesChangedEvent = { changed: boolean };
export type PaneDetachEvent = { pane_id: string; title?: string; cols?: number; rows?: number };
export type PaneReattachEvent = { pane_id: string };

export interface WorkerLaunchConfig {
  agent_type: string;
  cwd?: string | null;
  pane_id?: string | null;
  cols: number;
  rows: number;
  force_new: boolean;
}

export interface EnsureMcpResult {
  installed: boolean;
  changed: boolean;
  backend: string;
  message: string;
}

export interface McpBackendStatus {
  backend: string;
  label: string;
  installed: boolean;
  usesNpm: boolean;
  configPath: string;
  message: string;
}

export interface McpStatusReport {
  bridgeReachable: boolean;
  bridgeUrl: string | null;
  bridgeVersion: string | null;
  portFileExists: boolean;
  portFilePath: string;
  nodeAvailable: boolean;
  npmAvailable: boolean;
  npmPackageVersion: string | null;
  launchCommand: string;
  backends: McpBackendStatus[];
  overallReady: boolean;
  repairResults: EnsureMcpResult[];
}

export interface CoordinationStorageInfo {
  scope: 'project' | 'global_fallback' | string;
  project_path: string | null;
  storage_dir: string;
  event_log_path: string;
  event_count: number;
  task_count: number;
  lock_count: number;
  exists: boolean;
}

export interface OpenCodeKeyProfileInfo {
  id: string;
  label: string;
  configured: boolean;
}

export interface OpenCodeKeyStatus {
  active_profile: string;
  profiles: OpenCodeKeyProfileInfo[];
  key_automation_mode: string;
  restart_pane_on_rotate: boolean;
}

export interface RotateOpenCodeKeyResult {
  ok: boolean;
  active_profile: string;
  profiles: OpenCodeKeyProfileInfo[];
  restarted_panes: string[];
}

export interface AppInstallInfo {
  version: string;
  isPackaged: boolean;
  platform: string;
  uninstallAvailable: boolean;
  uninstallInstructions: string;
  dataDir: string;
}

export interface PortConfig {
  agent_min: number;
  agent_max: number;
  bridge_min: number;
  bridge_max: number;
}

export interface PortOwner {
  pid: number;
  name: string;
}

export interface PortEntry {
  role: string;
  port: number;
  pane_id: string | null;
  pid: number | null;
  listening: boolean;
  owner: PortOwner | null;
}

export interface ForeignPort {
  port: number;
  owner: PortOwner | null;
}

export interface PortsReport {
  config: PortConfig;
  entries: PortEntry[];
  foreign_in_range: ForeignPort[];
}

export const DEFAULT_PORT_CONFIG: PortConfig = {
  agent_min: 4096,
  agent_max: 4199,
  bridge_min: 17321,
  bridge_max: 17399,
};

const isTauriRuntime = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const noopUnlisten: UnlistenFn = () => {};

async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  fallback?: T,
  hasFallback = false,
): Promise<T> {
  if (!isTauriRuntime()) {
    if (hasFallback) return fallback as T;
    throw new Error(`Tauri command unavailable outside the desktop shell: ${command}`);
  }
  return invoke<T>(command, args);
}

async function safeListen<T>(event: string, cb: (e: T) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return noopUnlisten;
  return listen<T>(event, (payload) => cb(payload.payload));
}

async function safeEmit<T>(event: string, payload: T): Promise<void> {
  if (!isTauriRuntime()) return;
  await emit(event, payload);
}

async function closeCurrentWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    window.close();
    return;
  }
  await getCurrentWebviewWindow().destroy();
}

async function resizeCurrentWindow(width: number, height: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().setSize(new LogicalSize(width, height));
}

async function onCurrentWindowCloseRequested(
  cb: (event: CloseRequestedEvent) => void | Promise<void>,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return noopUnlisten;
  return getCurrentWindow().onCloseRequested(cb);
}

export const tauri = {
  listPanes: () => safeInvoke<PaneInfo[]>('list_panes', undefined, [], true),
  claudeListSessions: (cwd: string) =>
    safeInvoke<ClaudePastSession[]>('claude_list_sessions', { cwd }, [], true),
  listAgents: () =>
    safeInvoke<AgentCatalog>('list_agents', undefined, emptyAgentCatalog(), true),
  listResumableSessions: () =>
    safeInvoke<unknown[]>('list_resumable_sessions', undefined, [], true),
  sendSessionPrompt: (args: { pane_id: string; text: string }) =>
    safeInvoke<void>('send_session_prompt', { args }, undefined, true),
  readOpenCodeMessages: (args: { pane_id: string; limit?: number; role?: string }) =>
    safeInvoke<SessionMessagesView>(
      'read_opencode_messages',
      { args },
      {
        pane_id: args.pane_id,
        session_id: '',
        messages: [],
      },
      true,
    ),
  listOpenCodePermissions: (paneId: string) =>
    safeInvoke<OpenCodePermission[]>(
      'list_opencode_permissions',
      { paneId },
      [],
      true,
    ),
  replyOpenCodeQuestion: (args: { pane_id: string; answer: string; request_id?: string }) =>
    safeInvoke<unknown>('reply_opencode_question', { args }, {}, true),
  replyOpenCodePermission: (args: { pane_id: string; request_id: string; reply: string }) =>
    safeInvoke<void>('reply_opencode_permission', { args }, undefined, true),
  spawnPane: (args: {
    agent_type: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    extra_args?: string[];
    surface?: 'tui' | 'headless';
    pane_id?: string;
    resume_session_id?: string;
  }) => safeInvoke<string>('spawn_pane', { args }, `browser-preview-${Date.now()}`, true),
  killPane: (paneId: string) => safeInvoke<void>('kill_pane_cmd', { paneId }, undefined, true),
  killAllPanes: () => safeInvoke<void>('kill_all_panes', undefined, undefined, true),
  writeInput: (
    paneId: string,
    text: string,
    appendNewline = true,
    options?: { viaOpencodeApi?: boolean; modelProvider?: string; modelId?: string },
  ) =>
    safeInvoke<void>(
      'write_pane_input',
      {
        paneId,
        args: {
          text,
          append_newline: appendNewline,
          via_opencode_api: options?.viaOpencodeApi ?? false,
          model_provider: options?.modelProvider,
          model_id: options?.modelId,
        },
      },
      undefined,
      true,
    ),
  readBuffer: (paneId: string, lines: number) =>
    safeInvoke<string>('read_pane_buffer', { paneId, lines }, '', true),
  readSnapshot: (paneId: string) =>
    safeInvoke<string>('read_pane_snapshot', { paneId }, '', true),
  readRawBuffer: (paneId: string, lines: number) =>
    safeInvoke<number[]>('read_pane_raw_buffer', { paneId, lines }, [], true),
  listAgentContexts: () => safeInvoke<unknown[]>('list_agent_contexts', undefined, [], true),
  readAgentContext: (args: { agent_type?: string; pane_id?: string }) =>
    safeInvoke<unknown>('read_agent_context', { agentType: args.agent_type, paneId: args.pane_id }),
  inspectAgentModel: (paneId: string, lines?: number) =>
    safeInvoke<AgentModelInspection>('inspect_agent_model', { paneId, lines }),
  switchAgentModel: (paneId: string, args: { model_id: string; model_provider?: string }) =>
    safeInvoke<{ ok: boolean; provider_id: string; model_id: string; tui_synced?: boolean }>(
      'switch_agent_model',
      { paneId, args },
    ),
  resize: (paneId: string, cols: number, rows: number) =>
    safeInvoke<void>('resize_pane', { paneId, cols, rows }, undefined, true),
  setProjectPath: (path: string) => safeInvoke<void>('set_project_path', { path }, undefined, true),
  getProjectPath: () => safeInvoke<string>('get_project_path_cmd', undefined, '', true),
  getPersistedProjectPath: () =>
    safeInvoke<string>('get_persisted_project_path_cmd', undefined, '', true),
  getCoordinationStorageInfo: () =>
    safeInvoke<CoordinationStorageInfo>(
      'get_coordination_storage_info',
      undefined,
      {
        scope: 'global_fallback',
        project_path: null,
        storage_dir: '.loomria',
        event_log_path: '.loomria/events.jsonl',
        event_count: 0,
        task_count: 0,
        lock_count: 0,
        exists: false,
      },
      true,
    ),
  ensureOrchestratorMcp: (backend: string, projectPath: string) =>
    safeInvoke<EnsureMcpResult>(
      'ensure_orchestrator_mcp',
      { backend, projectPath },
      {
        installed: true,
        changed: false,
        backend,
        message: 'MCP install skipped in browser preview',
      },
      true,
    ),
  installNpmMcpConfigs: (projectPath: string) =>
    safeInvoke<EnsureMcpResult[]>(
      'install_npm_mcp_configs',
      { projectPath },
      [
        {
          installed: true,
          changed: false,
          backend: 'browser_preview',
          message: 'MCP npm install skipped in browser preview',
        },
      ],
      true,
    ),
  installGlobalNpmMcpConfigs: () =>
    safeInvoke<EnsureMcpResult[]>(
      'install_global_npm_mcp_configs',
      undefined,
      [
        {
          installed: true,
          changed: false,
          backend: 'browser_preview_global',
          message: 'Global MCP npm install skipped in browser preview',
        },
      ],
      true,
    ),
  uninstallNpmMcpConfigs: (projectPath: string) =>
    safeInvoke<EnsureMcpResult[]>(
      'uninstall_npm_mcp_configs',
      { projectPath },
      [
        {
          installed: false,
          changed: true,
          backend: 'browser_preview',
          message: 'MCP uninstall skipped in browser preview',
        },
      ],
      true,
    ),
  uninstallGlobalNpmMcpConfigs: () =>
    safeInvoke<EnsureMcpResult[]>(
      'uninstall_global_npm_mcp_configs',
      undefined,
      [
        {
          installed: false,
          changed: true,
          backend: 'browser_preview_global',
          message: 'Global MCP uninstall skipped in browser preview',
        },
      ],
      true,
    ),
  getMcpStatus: (projectPath: string, autoRepair = false) =>
    safeInvoke<McpStatusReport>(
      'get_mcp_status',
      { projectPath, autoRepair },
      {
        bridgeReachable: false,
        bridgeUrl: null,
        bridgeVersion: null,
        portFileExists: false,
        portFilePath: '',
        nodeAvailable: false,
        npmAvailable: false,
        npmPackageVersion: null,
        launchCommand: 'npx -y @loomria/mcp',
        backends: [],
        overallReady: false,
        repairResults: [],
      },
      true,
    ),

  pushChatEvent: (eventJson: string) =>
    safeInvoke<void>('push_chat_event', { eventJson }, undefined, true),
  pushSettingsEvent: (settingsJson: string) =>
    safeInvoke<void>('push_settings_event', { settingsJson }, undefined, true),
  syncPublicSettings: (settingsJson: string) =>
    safeInvoke<void>('sync_public_settings', { settingsJson }, undefined, true),
  onOrchestratorMessage: (cb: (e: { text: string; message_id: string }) => void): Promise<UnlistenFn> =>
    safeListen<{ text: string; message_id: string }>('orchestrator://message', cb),
  onSettingsApply: (cb: (e: { orchestrator_backend?: string; default_provider?: string; default_model?: string }) => void): Promise<UnlistenFn> =>
    safeListen<{ orchestrator_backend?: string; default_provider?: string; default_model?: string }>('settings://apply', cb),
  onSettingsChanged: (cb: (e: { orchestrator_backend?: string; default_provider?: string; default_model?: string }) => void): Promise<UnlistenFn> =>
    safeListen<{ orchestrator_backend?: string; default_provider?: string; default_model?: string }>('settings://changed', cb),
  onOrchestratorEnsure: (cb: (e: { backend: string }) => void): Promise<UnlistenFn> =>
    safeListen<{ backend: string }>('orchestrator://ensure', cb),

  onTerminalSnapshot: (cb: (e: TerminalSnapshotEvent) => void): Promise<UnlistenFn> =>
    safeListen<TerminalSnapshotEvent>('terminal-snapshot', cb),
  onTerminalData: (cb: (e: TerminalDataEvent) => void): Promise<UnlistenFn> =>
    safeListen<TerminalDataEvent>('terminal-data', cb),
  onPtyStatus: (cb: (e: PaneStatusEvent) => void): Promise<UnlistenFn> =>
    safeListen<PaneStatusEvent>('pty://status', cb),
  onPtyExit: (cb: (e: PaneExitEvent) => void): Promise<UnlistenFn> =>
    safeListen<PaneExitEvent>('pty://exit', cb),
  onPanesChanged: (cb: (e: PanesChangedEvent) => void): Promise<UnlistenFn> =>
    safeListen<PanesChangedEvent>('pty://panes-changed', cb),
  onPaneDetach: (cb: (e: PaneDetachEvent) => void): Promise<UnlistenFn> =>
    safeListen<PaneDetachEvent>('pane://detach', cb),
  onPaneReattach: (cb: (e: PaneReattachEvent) => void): Promise<UnlistenFn> =>
    safeListen<PaneReattachEvent>('pane://reattach', cb),
  emitPaneReattach: (paneId: string) => safeEmit<PaneReattachEvent>('pane://reattach', { pane_id: paneId }),
  closeCurrentWindow,
  resizeCurrentWindow,
  onCurrentWindowCloseRequested,

  getBridgeSession: () =>
    safeInvoke<BridgeSessionInfo>('get_bridge_session', undefined, { base_url: '', token: '' }, true),
  createMobilePairingSession: (bridgeUrl: string) =>
    safeInvoke<unknown>(
      'create_mobile_pairing_session',
      { bridgeUrl },
      null,
      true,
    ),
  listPairedMobileDevices: () => safeInvoke<unknown[]>('list_paired_mobile_devices', undefined, [], true),
  revokePairedMobileDevice: (deviceId: string) =>
    safeInvoke<boolean>('revoke_paired_mobile_device', { deviceId }, false, true),

  getMobileTunnelInfo: () =>
    safeInvoke<{
      localUrl: string;
      pwaUrl: string;
      tunnelUrl?: string | null;
      tunnelProvider?: string | null;
      bridgeProxyUrl: string;
      bridgeDirectUrl?: string | null;
      updatedAt: number;
    } | null>('get_mobile_tunnel_info', undefined, null, true),

  portsReport: () =>
    safeInvoke<PortsReport>(
      'ports_report',
      undefined,
      { config: DEFAULT_PORT_CONFIG, entries: [], foreign_in_range: [] },
      true,
    ),
  portsSetConfig: (config: PortConfig) => safeInvoke<PortConfig>('ports_set_config', { config }),

  getAppInstallInfo: () =>
    safeInvoke<AppInstallInfo>(
      'get_app_install_info',
      undefined,
      {
        version: '0.0.0',
        isPackaged: false,
        platform: 'browser',
        uninstallAvailable: false,
        uninstallInstructions: '',
        dataDir: '',
      },
      true,
    ),
  openExternalUrl: (url: string) =>
    safeInvoke<void>('open_external_url', { url }, undefined, true),
  launchUninstall: () => safeInvoke<void>('launch_uninstall', undefined, undefined, true),
  getWorkerLaunch: () => safeInvoke<WorkerLaunchConfig | null>('get_worker_launch', undefined, null, true),
  getOpenCodeKeyStatus: () =>
    safeInvoke<OpenCodeKeyStatus>(
      'get_opencode_key_status',
      undefined,
      {
        active_profile: 'a',
        profiles: [
          { id: 'a', label: 'Primary', configured: false },
          { id: 'b', label: 'Secondary', configured: false },
        ],
        key_automation_mode: 'auto_if_backup',
        restart_pane_on_rotate: true,
      },
      true,
    ),
  setOpenCodeAutomationSettings: (mode: 'auto_if_backup' | 'notify_only', restartPaneOnRotate: boolean) =>
    safeInvoke<OpenCodeKeyStatus>(
      'set_opencode_automation_settings',
      { mode, restartPaneOnRotate },
      {
        active_profile: 'a',
        profiles: [],
        key_automation_mode: mode,
        restart_pane_on_rotate: restartPaneOnRotate,
      },
      true,
    ),
  setOpenCodeKeyProfile: (profileId: string, apiKey: string, label?: string) =>
    safeInvoke<void>(
      'set_opencode_key_profile',
      { profileId, apiKey, label: label ?? null },
      undefined,
      true,
    ),
  captureOpenCodeKeyProfile: (profileId: string, label?: string) =>
    safeInvoke<void>(
      'capture_opencode_key_profile',
      { profileId, label: label ?? null },
      undefined,
      true,
    ),
  rotateOpenCodeKey: (profile: 'next' | 'a' | 'b', paneId?: string) =>
    safeInvoke<RotateOpenCodeKeyResult>(
      'rotate_opencode_key',
      { profile, paneId: paneId ?? null },
      { ok: true, active_profile: 'a', profiles: [], restarted_panes: [] },
      true,
    ),
  exitApp: () => safeInvoke<void>('exit_app', undefined, undefined, true),
};
