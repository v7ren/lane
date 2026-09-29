import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Message, Session } from '@loomria/shared/opencode';
import { exportSessionTranscript } from './export-transcript';
import { opencodeSessionActions } from './opencode-session-actions';
import { createFetchOpenCodeTransport, setOpenCodeTransport } from './opencode-transport';

const LIVE_PANE = 'live-test-pane';
const PROMPT = 'Reply with exactly the word ok';

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to reserve port'));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForOpenCode(baseUrl: string, directory: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `${baseUrl.replace(/\/$/, '')}/session?directory=${encodeURIComponent(directory)}`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server still starting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('OpenCode server did not become ready in time');
}

const BUSY_STATUSES = new Set(['working', 'busy', 'running', 'processing', 'active', 'streaming']);

async function waitForSessionIdle(
  paneId: string,
  sessionId: string,
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusMap = await opencodeSessionActions.getSessionStatus(paneId);
    const raw = statusMap[sessionId];
    const normalized = typeof raw === 'string' ? raw.toLowerCase() : 'idle';
    if (!BUSY_STATUSES.has(normalized)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`session ${sessionId} did not reach idle within ${timeoutMs}ms`);
}

async function whenSessionIdle<T>(
  paneId: string,
  sessionId: string,
  action: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + 60_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    await waitForSessionIdle(paneId, sessionId, 30_000);
    try {
      return await action();
    } catch (err) {
      lastErr = err;
      const msg = String(err);
      if (!msg.includes('SessionBusyError') && !msg.includes('409')) throw err;
      await new Promise((r) => setTimeout(r, 750));
    }
  }
  throw lastErr;
}

type OpenCodeMessage = Message & { info?: { id?: string; role?: string } };

function messageId(msg: OpenCodeMessage): string | undefined {
  return msg.id ?? msg.info?.id;
}

function messageRole(msg: OpenCodeMessage): string | undefined {
  return msg.info?.role ?? (msg as { role?: string }).role;
}

async function waitForAssistantMessageId(
  paneId: string,
  sessionId: string,
  timeoutMs = 180_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = (await opencodeSessionActions.listMessages(
      paneId,
      sessionId,
    )) as OpenCodeMessage[];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (messageRole(msg) === 'assistant' && messageId(msg)) {
        return messageId(msg)!;
      }
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error('assistant message not observed in time');
}

function sessionRevertActive(session: Session): boolean {
  const s = session as Session & { revert?: { messageID?: string } | null };
  return Boolean(s.revert?.messageID);
}

describe.skipIf(!process.env.RUN_LIVE_OPENCODE)('live OpenCode sessions', () => {
  let workDir: string;
  let port: number;
  let baseUrl: string;
  let serveProc: ChildProcess | null = null;
  const createdSessionIds: string[] = [];

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'loomria-oc-live-'));
    port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serveProc = spawn(
      'opencode',
      ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
      { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
    );
    await waitForOpenCode(baseUrl, workDir);
    setOpenCodeTransport(createFetchOpenCodeTransport(baseUrl, workDir));
  });

  afterEach(async () => {
    setOpenCodeTransport(null);
    for (const sessionId of [...createdSessionIds].reverse()) {
      try {
        await opencodeSessionActions.deleteSession(LIVE_PANE, sessionId);
      } catch {
        // best effort
      }
    }
    createdSessionIds.length = 0;
    if (serveProc && !serveProc.killed) {
      serveProc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        if (!serveProc) return resolve();
        serveProc.once('exit', () => resolve());
        setTimeout(() => {
          if (serveProc && !serveProc.killed) serveProc.kill('SIGKILL');
          resolve();
        }, 5000);
      });
    }
    serveProc = null;
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch {
      // Windows may keep handles briefly after serve exit.
    }
  });

  it('creates, renames, prompts, forks, reverts, exports, deletes', async () => {
    const results: Record<string, boolean> = {};

    try {
      const a = await opencodeSessionActions.createSession(LIVE_PANE, { title: 'Live A' });
      const b = await opencodeSessionActions.createSession(LIVE_PANE, { title: 'Live B' });
      createdSessionIds.push(a.id, b.id);
      results.create_two_sessions = a.id !== b.id;

      await opencodeSessionActions.patchSessionTitle(LIVE_PANE, b.id, 'Renamed live B');
      const renamed = await opencodeSessionActions.getSession(LIVE_PANE, b.id);
      results.rename_session = renamed.title === 'Renamed live B';

      await opencodeSessionActions.promptAsync(LIVE_PANE, a.id, {
        parts: [{ type: 'text', text: PROMPT }],
      });
      const assistantMessageId = await waitForAssistantMessageId(LIVE_PANE, a.id);
      await waitForSessionIdle(LIVE_PANE, a.id);
      results.prompt_and_idle = Boolean(assistantMessageId);

      const messages = await opencodeSessionActions.listMessages(LIVE_PANE, a.id);
      results.messages_nonempty = messages.length >= 2;
      const forkMessageId = assistantMessageId;

      const forked = await whenSessionIdle(LIVE_PANE, a.id, () =>
        opencodeSessionActions.forkSession(LIVE_PANE, a.id, { messageID: forkMessageId }),
      );
      createdSessionIds.push(forked.id);
      results.fork_session = forked.id !== a.id;

      await whenSessionIdle(LIVE_PANE, a.id, () =>
        opencodeSessionActions.revertSession(LIVE_PANE, a.id, { messageID: forkMessageId }),
      );
      const reverted = await opencodeSessionActions.getSession(LIVE_PANE, a.id);
      results.revert_session = sessionRevertActive(reverted);

      await whenSessionIdle(LIVE_PANE, a.id, () =>
        opencodeSessionActions.unrevertSession(LIVE_PANE, a.id),
      );
      const restored = await opencodeSessionActions.getSession(LIVE_PANE, a.id);
      results.unrevert_session = !sessionRevertActive(restored);

      const children = await opencodeSessionActions.listSessionChildren(LIVE_PANE, a.id);
      results.get_children = Array.isArray(children);
      const listed = await opencodeSessionActions.listSessions(LIVE_PANE);
      results.fork_listed = listed.some((s) => s.id === forked.id);

      const exported = await exportSessionTranscript({
        paneId: LIVE_PANE,
        sessionId: a.id,
        title: renamed.title ?? 'session',
        format: 'markdown',
      });
      results.export_markdown =
        exported.contents.includes('#') && exported.defaultName.endsWith('.md');

      const idsToDelete = [...createdSessionIds];
      for (const id of idsToDelete) {
        await opencodeSessionActions.deleteSession(LIVE_PANE, id);
      }
      const remaining = await opencodeSessionActions.listSessions(LIVE_PANE);
      results.delete_all = !remaining.some((s) => idsToDelete.includes(s.id));
      createdSessionIds.length = 0;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('live OpenCode failure', err, results);
      throw err;
    }

    for (const [step, ok] of Object.entries(results)) {
      expect(ok, step).toBe(true);
    }
  }, 240_000);
});

describe('live placeholder', () => {
  it('skipped unless RUN_LIVE_OPENCODE=1', () => {
    expect(true).toBe(true);
  });
});
