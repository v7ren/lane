import { describe, expect, it, vi } from 'vitest';
import { ADD_TO_COMPOSER_EVENT, dispatchAddToComposer } from './add-to-composer';

describe('add-to-composer event', () => {
  it('dispatches loomria:add-to-composer with path detail', () => {
    const handler = vi.fn();
    window.addEventListener(ADD_TO_COMPOSER_EVENT, handler);
    dispatchAddToComposer({ path: 'src/main.ts', selection: 'fn main' });
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ path: 'src/main.ts', selection: 'fn main' });
    window.removeEventListener(ADD_TO_COMPOSER_EVENT, handler);
  });
});
