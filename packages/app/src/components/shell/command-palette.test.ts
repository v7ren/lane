import { describe, expect, it } from 'vitest';
import { filterPaletteCommands, type PaletteCommand } from './CommandPalette';

const sample: PaletteCommand[] = [
  { id: '1', label: 'New agent: OpenCode', section: 'Agent', run: () => {} },
  { id: '2', label: 'Toggle bottom panel', section: 'View', run: () => {} },
  { id: '3', label: 'Switch session: Bridge fix', section: 'Session', keywords: 'opencode', run: () => {} },
];

describe('filterPaletteCommands', () => {
  it('returns all commands for empty query', () => {
    expect(filterPaletteCommands(sample, '')).toHaveLength(3);
  });

  it('filters by label and keywords', () => {
    expect(filterPaletteCommands(sample, 'opencode').map((c) => c.id)).toEqual(['1', '3']);
    expect(filterPaletteCommands(sample, 'toggle').map((c) => c.id)).toEqual(['2']);
  });
});
