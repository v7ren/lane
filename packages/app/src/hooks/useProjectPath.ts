import { useCallback, useEffect, useState } from 'react';

import { useDemoFixtures } from '../lib/demo/DemoContext';

import { isValidProjectPath } from '../lib/project-path';

import { invalidateSettingsCache } from '../lib/settings';

import { tauri } from '../lib/tauri';

export function useProjectPath() {
  const demo = useDemoFixtures();
  const [projectPath, setProjectPathState] = useState<string | null>(() => demo?.projectPath ?? null);
  const [ready, setReady] = useState(Boolean(demo));

  useEffect(() => {
    if (demo) return;

    void (async () => {
      try {
        const persisted = (await tauri.getPersistedProjectPath()) || null;

        if (isValidProjectPath(persisted)) {
          await tauri.setProjectPath(persisted);
          const resolved = await tauri.getProjectPath();
          setProjectPathState(resolved);
          return;
        }

        const fromRegistry = (await tauri.getProjectPath()) || null;
        if (isValidProjectPath(fromRegistry)) {
          await tauri.setProjectPath(fromRegistry);
          const resolved = await tauri.getProjectPath();
          setProjectPathState(resolved);
        }
      } finally {
        setReady(true);
      }
    })();
  }, [demo]);

  const setProjectPath = useCallback(async (path: string) => {
    if (demo) {
      setProjectPathState(path);
      return;
    }

    await tauri.setProjectPath(path);
    const resolved = await tauri.getProjectPath();
    invalidateSettingsCache();
    setProjectPathState(resolved);
  }, [demo]);

  return { projectPath: demo?.projectPath ?? projectPath, setProjectPath, ready };
}
