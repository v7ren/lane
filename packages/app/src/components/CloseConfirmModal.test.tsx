import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseConfirmModal } from './CloseConfirmModal';

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe('CloseConfirmModal', () => {
  it('calls onConfirm from the primary button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const root = createRoot(container);
    act(() => {
      root.render(<CloseConfirmModal agentCount={2} onConfirm={onConfirm} onCancel={onCancel} />);
    });
    const ok = container.querySelector('[data-testid="close-confirm-ok"]') as HTMLButtonElement;
    act(() => ok.click());
    expect(onConfirm).toHaveBeenCalled();
    act(() => root.unmount());
  });
});
