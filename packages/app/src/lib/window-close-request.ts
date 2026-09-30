export type CloseConfirmRequest = {
  agentCount: number;
  resolve: (confirmed: boolean) => void;
};

let listener: ((req: CloseConfirmRequest) => void) | null = null;
let closeConfirmed = false;

export function setCloseConfirmListener(fn: ((req: CloseConfirmRequest) => void) | null): void {
  listener = fn;
}

export function isAppCloseConfirmed(): boolean {
  return closeConfirmed;
}

export function markAppCloseConfirmed(): void {
  closeConfirmed = true;
}

/** Test-only reset for module-level close confirmation state. */
export function resetAppCloseConfirmForTests(): void {
  closeConfirmed = false;
}

export function requestCloseConfirm(agentCount: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(false);
      return;
    }
    listener({ agentCount, resolve });
  });
}
