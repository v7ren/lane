import { describe, expect, it } from 'vitest';

import { normalizePathForDisplay, unescapeDisplayPath } from './path-display.js';
import { normalizeToolPayload } from './tool-mapping.js';

describe('path display', () => {
  it('unescapes JSON-style Windows paths', () => {
    expect(unescapeDisplayPath('"C:\\\\Users\\\\Ren\\\\hello.txt"')).toBe('C:\\Users\\Ren\\hello.txt');
  });

  it('makes glob output paths relative to project root', () => {
    const { output } = normalizeToolPayload(
      'glob',
      { pattern: '**/hello.txt' },
      ['C:\\\\Users\\\\Ren\\\\repo\\\\hello.txt'],
      { projectRoot: 'C:/Users/Ren/repo' },
    );
    expect(output).toEqual({ matches: ['hello.txt'], count: 1 });
  });
});

describe('normalizePathForDisplay', () => {
  it('strips project prefix', () => {
    expect(
      normalizePathForDisplay('C:\\work\\repo\\src\\main.ts', 'C:/work/repo'),
    ).toBe('src/main.ts');
  });
});
