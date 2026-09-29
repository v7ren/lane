import { describe, expect, it, vi } from 'vitest';

describe('recent workspaces settings store', () => {
  it('uses the shared settings LazyStore factory', async () => {
    const getStore = vi.fn(() => ({
      get: vi.fn(async () => []),
      set: vi.fn(),
      save: vi.fn(),
    }));
    vi.doMock('../settings', () => ({
      getSettingsLazyStore: getStore,
      enqueueSettingsFileWrite: (fn: () => Promise<unknown>) => fn(),
    }));
    const { pushRecentWorkspace } = await import('./recent-workspaces');
    await pushRecentWorkspace('C:\\tmp\\proj');
    expect(getStore).toHaveBeenCalled();
  });
});
