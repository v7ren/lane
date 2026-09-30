import type { PromptPart } from '../commands/agent.js';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type PendingUploadAttachment = {
  file: File;
  previewUrl: string;
};

export function attachmentSizeError(
  file: File,
  maxBytes = MAX_ATTACHMENT_BYTES,
): string | null {
  if (file.size > maxBytes) {
    const limitMb = Math.floor(maxBytes / (1024 * 1024));
    return `Attachment "${file.name}" exceeds ${limitMb} MB`;
  }
  return null;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to read attachment'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read attachment'));
    reader.readAsDataURL(file);
  });
}

export async function encodeFileAttachment(file: File): Promise<PromptPart> {
  const sizeErr = attachmentSizeError(file);
  if (sizeErr) throw new Error(sizeErr);
  const url = await readFileAsDataUrl(file);
  return {
    type: 'file',
    mime: file.type || 'application/octet-stream',
    filename: file.name,
    url,
  };
}

export async function encodeUploadAttachments(
  uploads: PendingUploadAttachment[],
): Promise<PromptPart[]> {
  const out: PromptPart[] = [];
  for (const upload of uploads) {
    out.push(await encodeFileAttachment(upload.file));
  }
  return out;
}

export function revokeAttachmentPreviews(uploads: PendingUploadAttachment[]): void {
  for (const upload of uploads) {
    if (upload.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(upload.previewUrl);
    }
  }
}

export async function buildPromptPartsFromComposer(args: {
  mentionFileParts: PromptPart[];
  uploads: PendingUploadAttachment[];
  text: string;
}): Promise<PromptPart[]> {
  const encoded = await encodeUploadAttachments(args.uploads);
  return [...args.mentionFileParts, ...encoded, { type: 'text', text: args.text }];
}
