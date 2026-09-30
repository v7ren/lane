import { describe, expect, it, vi } from 'vitest';

import {
  attachmentSizeError,
  buildPromptPartsFromComposer,
  encodeFileAttachment,
  MAX_ATTACHMENT_BYTES,
  readFileAsDataUrl,
} from './encode-attachment.js';

describe('encode-attachment', () => {
  it('readFileAsDataUrl returns data URL with mime', async () => {
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const url = await readFileAsDataUrl(file);
    expect(url.startsWith('data:text/plain;base64,')).toBe(true);
  });

  it('encodeFileAttachment uses data URL not blob', async () => {
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    const part = await encodeFileAttachment(file);
    expect(part.type).toBe('file');
    if (part.type !== 'file') throw new Error('expected file part');
    expect(part.url.startsWith('data:image/png;base64,')).toBe(true);
    expect(part.url.startsWith('blob:')).toBe(false);
    expect(part.filename).toBe('pic.png');
  });

  it('rejects oversize files', async () => {
    const big = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'big.bin');
    expect(attachmentSizeError(big)).toMatch(/exceeds 10 MB/);
    await expect(encodeFileAttachment(big)).rejects.toThrow(/exceeds 10 MB/);
  });

  it('buildPromptPartsFromComposer encodes uploads for prompt_async', async () => {
    const file = new File(['img'], 'shot.png', { type: 'image/png' });
    const parts = await buildPromptPartsFromComposer({
      mentionFileParts: [{ type: 'file', mime: 'text/plain', url: 'file://src/a.ts', filename: 'a.ts' }],
      uploads: [{ file, previewUrl: 'blob:preview' }],
      text: 'see this',
    });
    const uploadPart = parts.find(
      (p): p is Extract<typeof p, { type: 'file' }> =>
        p.type === 'file' && p.filename === 'shot.png',
    );
    expect(uploadPart?.url.startsWith('data:image/png')).toBe(true);
    expect(parts[parts.length - 1]).toEqual({ type: 'text', text: 'see this' });
  });
});

describe('encodeFileAttachment oversize async', () => {
  it('throws on encode when file is too large', async () => {
    const big = new File([new Uint8Array(8)], 'big.bin');
    vi.spyOn(big, 'size', 'get').mockReturnValue(MAX_ATTACHMENT_BYTES + 1);
    await expect(encodeFileAttachment(big)).rejects.toThrow(/exceeds 10 MB/);
  });
});
