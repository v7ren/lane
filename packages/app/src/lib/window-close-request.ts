export type CloseConfirmRequest = {
  agentCount: number;
  resolve: (confirmed: boolean) => void;
};

let listener: ((req: CloseConfirmRequest) => void) | null = null;

export function setCloseConfirmListener(fn: ((req: CloseConfirmRequest) => void) | null): void {
  listener = fn;
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
