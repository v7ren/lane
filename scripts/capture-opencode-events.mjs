#!/usr/bin/env node
/**
 * Capture OpenCode SSE for store replay fixtures.
 * Usage: node scripts/capture-opencode-events.mjs <baseUrl> <directory> [outFileName]
 * Env: OPENCODE_CAPTURE_PROMPT — prompt text (default: read hello.txt)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:4096').replace(/\/$/, '');
const directory = process.argv[3] ?? process.cwd();
const outFile = process.argv[4] ?? 'live-capture.json';
const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages/app/src/lib/opencode/__fixtures__',
);

const DEFAULT_PROMPT =
  'Read the file hello.txt and reply with its first word';
const promptText = process.env.OPENCODE_CAPTURE_PROMPT ?? DEFAULT_PROMPT;

const CAPTURE_MAX_MS = 180_000;
const IDLE_GRACE_MS = 3_000;

const events = [];
const eventTypes = new Set();
let sessionId = null;
let promptSent = false;
let sawIdle = false;
let idleSince = null;
const repliedPermissions = new Set();

function sanitizeValue(value, captureDir) {
  if (typeof value === 'string') {
    let s = value;
    s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
    s = s.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '<api-key>');
    s = s.replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '<api-key>');
    const normalizedDir = captureDir.replace(/\\/g, '/');
    const winDir = captureDir.replace(/\//g, '\\');
    if (normalizedDir) {
      s = s.split(normalizedDir).join('<project-dir>');
      s = s.split(winDir).join('<project-dir>');
    }
    s = s.replace(/C:\\Users\\[^\\]+/gi, 'C:\\Users\\<user>');
    s = s.replace(/\/Users\/[^/]+/g, '/Users/<user>');
    s = s.replace(/Users[/\\][A-Za-z0-9._-]+[/\\]/gi, 'Users/<user>/');
    return s;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, captureDir));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = sanitizeValue(val, captureDir);
    }
    return out;
  }
  return value;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) {
    return null;
  }
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) {
    return null;
  }
  return res.json();
}

async function deleteSession(id) {
  const url = `${baseUrl}/session/${id}?directory=${encodeURIComponent(directory)}`;
  await fetch(url, { method: 'DELETE' });
}

async function maybeReplyPermissions() {
  if (!sessionId) {
    return;
  }
  const url = `${baseUrl}/permission?directory=${encodeURIComponent(directory)}`;
  let list;
  try {
    list = await getJson(url);
  } catch {
    return;
  }
  if (!Array.isArray(list)) {
    return;
  }
  for (const item of list) {
    const id = item.id ?? item.requestID;
    if (!id || repliedPermissions.has(id)) {
      continue;
    }
    const sid = item.sessionID ?? item.sessionId;
    if (sid && sid !== sessionId) {
      continue;
    }
    repliedPermissions.add(id);
    await postJson(
      `${baseUrl}/permission/${id}/reply?directory=${encodeURIComponent(directory)}`,
      { reply: 'once' },
    );
    console.log('Replied permission once:', id);
  }
}

async function sendPromptOnce() {
  if (promptSent) {
    return;
  }
  promptSent = true;
  const session = await postJson(
    `${baseUrl}/session?directory=${encodeURIComponent(directory)}`,
    { title: 'loomria fixture capture' },
  );
  sessionId = session.id;
  console.log('Created session', sessionId);
  await postJson(
    `${baseUrl}/session/${sessionId}/prompt_async?directory=${encodeURIComponent(directory)}`,
    { parts: [{ type: 'text', text: promptText }] },
  );
  console.log('Sent prompt (1)');
}

const started = Date.now();
const eventUrl = `${baseUrl}/event?directory=${encodeURIComponent(directory)}`;
const res = await fetch(eventUrl, { headers: { Accept: 'text/event-stream' } });
if (!res.ok || !res.body) {
  console.error('SSE connect failed', res.status);
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (Date.now() - started < CAPTURE_MAX_MS) {
  if (sawIdle && idleSince && Date.now() - idleSince >= IDLE_GRACE_MS) {
    break;
  }

  const waitMs = sawIdle ? IDLE_GRACE_MS : 5_000;
  const readPromise = reader.read();
  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => resolve({ value: undefined, done: false, timedOut: true }), waitMs),
  );
  const result = await Promise.race([readPromise, timeoutPromise]);

  if (result.timedOut) {
    await maybeReplyPermissions();
    continue;
  }

  const { value, done } = result;
  if (done) {
    break;
  }
  buffer += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buffer.indexOf('\n\n')) >= 0) {
    const chunk = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data:')) {
        continue;
      }
      const data = line.slice(5).trim();
      if (!data) {
        continue;
      }
      try {
        const parsed = JSON.parse(data);
        const wire = parsed.payload ? parsed.payload : parsed;
        if (!wire?.id || !wire?.type) {
          continue;
        }
        eventTypes.add(wire.type);
        events.push({
          id: wire.id,
          type: wire.type,
          properties: wire.properties ?? {},
        });

        if (wire.type === 'server.connected' && !promptSent) {
          await sendPromptOnce();
        }

        if (
          sessionId &&
          (wire.type === 'session.idle' ||
            (wire.type === 'session.status' &&
              wire.properties?.sessionID === sessionId &&
              wire.properties?.status === 'idle'))
        ) {
          sawIdle = true;
          idleSince = idleSince ?? Date.now();
        }

        if (
          wire.type === 'permission.asked' ||
          wire.type === 'permission.v2.asked'
        ) {
          await maybeReplyPermissions();
        }
      } catch {
        // ignore malformed frames
      }
    }
  }
}

try {
  reader.cancel().catch(() => {});
} catch {
  // ignore
}

if (sessionId) {
  try {
    await deleteSession(sessionId);
    console.log('Deleted session', sessionId);
  } catch (err) {
    console.warn('Session delete failed', err);
  }
}

const sanitizedEvents = events.map((ev) => ({
  id: ev.id,
  type: ev.type,
  properties: sanitizeValue(ev.properties, directory),
}));

fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, outFile);
const payload = {
  capturedAt: new Date().toISOString(),
  promptCount: promptSent ? 1 : 0,
  sessionId: sessionId ? '<session-id>' : null,
  eventTypes: [...eventTypes].sort(),
  events: sanitizedEvents,
};
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${sanitizedEvents.length} events to ${outPath}`);
console.log('Event types:', payload.eventTypes.join(', '));
if (!sawIdle) {
  console.warn('Warning: did not observe session idle before timeout');
  process.exitCode = 1;
}
