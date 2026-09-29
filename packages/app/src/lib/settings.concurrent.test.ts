import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Settings } from '@loomria/shared';



const storeState = new Map<string, unknown>();

const mockStore = {

  get: vi.fn(async (key: string) => storeState.get(key)),

  set: vi.fn(async (key: string, value: unknown) => {

    storeState.set(key, value);

  }),

  save: vi.fn(async () => {}),

};



vi.mock('@tauri-apps/plugin-store', () => ({

  LazyStore: vi.fn(() => mockStore),

}));



vi.mock('./tauri', () => ({

  tauri: {

    syncPublicSettings: vi.fn(),

    pushSettingsEvent: vi.fn(),

  },

}));



vi.mock('./bridge-settings', () => ({

  toPublicSettings: (s: Settings) => s,

}));



describe('updateSettings concurrent writers', () => {

  beforeEach(() => {

    storeState.clear();

    mockStore.get.mockClear();

    mockStore.set.mockClear();

    mockStore.save.mockClear();

    storeState.set('settings', {

      project_path: 'C:\\old',

      sidebar_width: 360,

      theme: 'dark',

    });

  });



  it('merges interleaved project_path, shell_layout, and recent_workspaces patches', async () => {

    const { updateSettings, enqueueSettingsFileWrite, getSettingsLazyStore, resetSettingsFileQueueForTests } =
      await import('./settings');
    resetSettingsFileQueueForTests();

    const { pushRecentWorkspace } = await import('./sessions/recent-workspaces');



    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));



    const writers = [

      (async () => {

        await delay(5);

        await updateSettings({ project_path: 'C:\\new-repo' });

      })(),

      (async () => {

        await delay(0);

        await updateSettings({

          shell_layout: {

            activityRailWidth: 48,
            sidebarWidth: 400,

            explorerWidth: 260,

            rightRailWidth: 320,

            bottomPanelPercent: 42,

            sidebarCollapsed: false,

            explorerCollapsed: false,

            rightRailCollapsed: false,

            bottomPanelCollapsed: false,

          },

        });

      })(),

      (async () => {

        await delay(10);

        await pushRecentWorkspace('C:\\new-repo');

      })(),

    ];



    await Promise.all(writers);



    const settings = await updateSettings((s) => s);

    expect(settings.project_path).toBe('C:\\new-repo');

    expect(settings.shell_layout?.sidebarWidth).toBe(400);



    const recent = await enqueueSettingsFileWrite(() =>

      getSettingsLazyStore().get<string[]>('recent_workspaces'),

    );

    expect(recent).toEqual(['C:\\new-repo']);

  });

});


