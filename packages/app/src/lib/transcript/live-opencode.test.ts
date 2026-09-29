import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { opencodeClient, setOpenCodeTransport } from '../opencode/client.js';
import {
  applyOpenCodeWireEvent,
  createEmptyOpenCodeStore,
  type OpenCodeStoreState,
} from '../opencode/store.js';
import { createFetchOpenCodeTransport, streamOpenCodeEvents } from '../opencode/transport.js';
import type { Message, OpenCodeWireEvent, Part } from '@loomria/shared/opencode';
import { fromOpenCode } from './from-opencode.js';

const LIVE = process.env.LOOMRIA_LIVE_OPENCODE === '1';
const PANE = 'live-opencode-pane';
const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'live_opencode_capture.json',
);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no port'));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForHttpOk(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server not ready: ${url}`);
}

function wireFromPayload(payload: unknown): OpenCodeWireEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.type === 'string' && typeof raw.id === 'string') {
    return raw as OpenCodeWireEvent;
  }
  const inner = raw.event ?? raw.data;
  if (inner && typeof inner === 'object') {
    const ev = inner as Record<string, unknown>;
    if (typeof ev.type === 'string') {
      const id =
        typeof ev.id === 'string'
          ? ev.id
          : `${ev.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return { id, type: ev.type, properties: ev.properties ?? ev } as OpenCodeWireEvent;
    }
  }
  return null;
}

function assertTranscriptHasHelloTurn(vm: ReturnType<typeof fromOpenCode>) {
  const user = vm.turns.find((t) => t.role === 'user');
  expect(user?.items.some((i) => i.kind === 'user_prompt')).toBe(true);

  const assistantItems = vm.turns.filter((t) => t.role === 'assistant').flatMap((t) => t.items);
  const readTool = assistantItems.find(
    (i) => i.kind === 'tool_call' && i.name === 'read' && i.status === 'completed',
  );
  expect(readTool).toBeTruthy();

  const textItem = assistantItems.find((i) => i.kind === 'assistant_text');
  expect(textItem?.kind === 'assistant_text' && /hello/i.test(textItem.markdown)).toBe(true);

  const metaTurn = [...vm.turns].reverse().find((t) => t.role === 'assistant' && t.meta?.model);
  expect(metaTurn?.meta?.model).toBeTruthy();
}

type MessageRow = { info: Message; parts?: Part[] };

function normalizeMessageRows(raw: unknown): MessageRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    if (row && typeof row === 'object' && 'info' in row) {
      return row as MessageRow;
    }
    const message = row as Message & { parts?: Part[] };
    return { info: message, parts: message.parts };
  });
}

function hydrateStoreFromMessages(
  state: OpenCodeStoreState,
  rows: MessageRow[],
  capture: OpenCodeWireEvent[],
): OpenCodeStoreState {
  let next = state;
  for (const row of rows) {
    const message = row.info;
    const msgWire: OpenCodeWireEvent = {
      id: `hydrate-message-${message.id}`,
      type: 'message.updated',
      properties: { info: message },
    };
    capture.push(msgWire);
    next = applyOpenCodeWireEvent(next, msgWire);
    for (const part of row.parts ?? []) {
      const partWire: OpenCodeWireEvent = {
        id: `hydrate-part-${part.id}`,
        type: 'message.part.updated',
        properties: { part, messageID: message.id },
      };
      capture.push(partWire);
      next = applyOpenCodeWireEvent(next, partWire);
    }
  }
  return next;
}

async function waitForHelloTranscript(
  sessionId: string,
  state: OpenCodeStoreState,
  capture: OpenCodeWireEvent[],
): Promise<OpenCodeStoreState> {
  const deadline = Date.now() + 240_000;
  let next = state;
  while (Date.now() < deadline) {
    const rows = normalizeMessageRows(await opencodeClient.listMessages(PANE, sessionId));
    next = hydrateStoreFromMessages(next, rows, capture);
    const vm = fromOpenCode(next, sessionId);
    try {
      assertTranscriptHasHelloTurn(vm);
      return next;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Timed out waiting for hello transcript');
}

describe('live OpenCode capture replay', () => {
  it.skipIf(!existsSync(FIXTURE_PATH))('replays saved wire events into fromOpenCode', async () => {
    const raw = await fs.readFile(FIXTURE_PATH, 'utf8');
    const capture = JSON.parse(raw) as {
      sessionId: string;
      events: OpenCodeWireEvent[];
    };
    let state: OpenCodeStoreState = createEmptyOpenCodeStore(PANE);
    for (const ev of capture.events) {
      state = applyOpenCodeWireEvent(state, ev);
    }
    const vm = fromOpenCode(state, capture.sessionId);
    assertTranscriptHasHelloTurn(vm);
  });
});

describe.skipIf(!LIVE)('live OpenCode HTTP integration', () => {
  let workDir = '';
  let baseUrl = '';
  let directory = '';
  let child: ChildProcessWithoutNullStreams | null = null;
  let sessionId = '';
  const capturedEvents: OpenCodeWireEvent[] = [];
  let promptCount = 0;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loomria-live-oc-'));
    await fs.writeFile(path.join(workDir, 'hello.txt'), 'hello world\n', 'utf8');
    directory = workDir;
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const bin = process.platform === 'win32' ? 'opencode.cmd' : 'opencode';
    child = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: workDir,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
    child.stderr.on('data', () => {});
    child.stdout.on('data', () => {});
    await waitForHttpOk(`${baseUrl}/session?directory=${encodeURIComponent(directory)}`, 180_000);

    setOpenCodeTransport(createFetchOpenCodeTransport(baseUrl, directory));
  }, 200_000);

  afterAll(async () => {
    setOpenCodeTransport(null);
    if (child) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child!.on('exit', () => resolve());
        setTimeout(() => {
          try {
            child!.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          resolve();
        }, 5000);
      });
      child = null;
    }
    if (workDir) {
      for (let i = 0; i < 5; i += 1) {
        try {
          await fs.rm(workDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
  }, 30_000);

  it('exercises composer routes and maps one prompt turn', async () => {
    await opencodeClient.listAgents(PANE);
    await opencodeClient.listProviders(PANE);
    await opencodeClient.listCommands(PANE);
    await opencodeClient.listConfigProviders(PANE);
    const files = await opencodeClient.findFiles(PANE, { query: 'hello', limit: '8' });
    expect(files.some((f) => f.path.includes('hello'))).toBe(true);

    const session = await opencodeClient.createSession(PANE, { title: 'live test' });
    sessionId = session.id;
    promptCount += 1;

    let state: OpenCodeStoreState = {
      ...createEmptyOpenCodeStore(PANE),
      directory,
      healthy: true,
      connectionStatus: 'connected',
    };
    state = applyOpenCodeWireEvent(state, {
      id: 'live-session-created',
      type: 'session.created',
      properties: { session },
    } as OpenCodeWireEvent);

    const abort = new AbortController();
    const streamDone = streamOpenCodeEvents(baseUrl, directory, (payload) => {
      const wire = wireFromPayload(payload);
      if (!wire) return;
      capturedEvents.push(wire);
      state = applyOpenCodeWireEvent(state, wire);
    }, abort.signal);

    await opencodeClient.promptAsync(PANE, sessionId, {
      parts: [{ type: 'text', text: 'Read hello.txt and reply with its first word only.' }],
    });

    state = await waitForHelloTranscript(sessionId, state, capturedEvents);

    abort.abort();
    await streamDone.catch(() => {});

    assertTranscriptHasHelloTurn(fromOpenCode(state, sessionId));

    await fs.mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
    await fs.writeFile(
      FIXTURE_PATH,
      JSON.stringify({ sessionId, events: capturedEvents }, null, 2),
      'utf8',
    );
  }, 360_000);

  it('aborts a second tiny prompt when still cheap', async () => {
    if (!sessionId) return;
    promptCount += 1;
    await opencodeClient.promptAsync(PANE, sessionId, {
      parts: [{ type: 'text', text: 'Reply with the single letter x.' }],
    });
    await new Promise((r) => setTimeout(r, 800));
    await opencodeClient.abortSession(PANE, sessionId);
    expect(promptCount).toBeLessThanOrEqual(2);
  }, 60_000);
});
