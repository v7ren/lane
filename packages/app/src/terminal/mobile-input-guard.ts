export const MOBILE_INPUT_HIDDEN_CLASS = 'pm-mobile-input-hidden';

export type MobileInputDelivery = 'immediate' | 'buffered';

export function isMobileInputDevice(): boolean {
  return false;
}

export function configureXtermTextareaForMobileMirror(_textarea: HTMLTextAreaElement): void {
  /* desktop strip */
}

export class MobileInputGuard {
  constructor(_opts: {
    container: HTMLElement;
    emitInput: (text: string, delivery: MobileInputDelivery) => void;
    scrollToCursor: () => void;
    bufferDelayMs?: number;
    inputVisible?: boolean;
  }) {}

  dispose(): void {}
}
