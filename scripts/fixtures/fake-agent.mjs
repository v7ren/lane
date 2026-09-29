#!/usr/bin/env node
/**
 * Minimal TUI stand-in for harness smoke tests (no API keys).
 * - Prints a banner and `fake>` prompt
 * - Echoes input
 * - `approve` → prints approval menu strings for attention-regex tests
 * - `exit` → clean shutdown
 */
import readline from 'node:readline';

console.log('Fake Agent v1 (loomria harness fixture)');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

function showPrompt() {
  process.stdout.write('fake> ');
}

showPrompt();

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === 'exit' || trimmed === 'quit') {
    rl.close();
    process.exit(0);
  }
  if (trimmed === 'approve') {
    console.log('Allow once / Allow always');
    showPrompt();
    return;
  }
  if (trimmed.length > 0) {
    console.log(`echo: ${line}`);
  }
  showPrompt();
});

rl.on('close', () => {
  process.exit(0);
});
