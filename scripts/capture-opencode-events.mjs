#!/usr/bin/env node
/**
 * Read-only capture of OpenCode SSE for store replay fixtures.
 * Usage: node scripts/capture-opencode-events.mjs [baseUrl] [directory]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:4096').replace(/\/$/, '');
const directory = process.argv[3] ?? process.cwd();
const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages/app/src/lib/opencode/__fixtures__',
);

const events = [];
const started = Date.now();
const CAPTURE_MS = 20_000;
let sessionId = null;
let promptSent = false;

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

const eventUrl = `${baseUrl}/event?directory=${encodeURIComponent(directory)}`;
const res = await fetch(eventUrl, { headers: { Accept: 'text/event-stream' } });
if (!res.ok || !res.body) {
  console.error('SSE connect failed', res.status);
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

const timer = setTimeout(async () => {
  reader.cancel().catch(() => {});
}, CAPTURE_MS);

while (Date.now() - started < CAPTURE_MS) {
  const { value, done } = await reader.read();
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
        events.push({ id: wire.id, type: wire.type, properties: wire.properties ?? {} });
        if (!sessionId && wire.type === 'server.connected' && !promptSent) {
          promptSent = true;
          const session = await postJson(
            `${baseUrl}/session?directory=${encodeURIComponent(directory)}`,
            { title: 'loomria fixture capture' },
          );
          sessionId = session.id;
          await postJson(
            `${baseUrl}/session/${sessionId}/prompt_async?directory=${encodeURIComponent(directory)}`,
            { parts: [{ type: 'text', text: 'Reply with exactly the word ok' }] },
          );
        }
      } catch {
        // ignore malformed frames
      }
    }
  }
}

clearTimeout(timer);
if (sessionId) {
  try {
    await deleteSession(sessionId);
  } catch {
    // best effort cleanup
  }
}

fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'live-capture.json');
fs.writeFileSync(outPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), events }, null, 2)}\n`);
console.log(`Wrote ${events.length} events to ${outPath}`);
