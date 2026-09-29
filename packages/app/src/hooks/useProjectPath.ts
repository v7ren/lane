import { useCallback, useEffect, useState } from 'react';
import { useDemoFixtures } from '../lib/demo/DemoContext';
import { loadSettings, saveSettings } from '../lib/settings';
import { isValidProjectPath } from '../lib/project-path';
import { tauri } from '../lib/tauri';

export function useProjectPath() {
  const demo = useDemoFixtures();
  const [projectPath, setProjectPathState] = useState<string | null>(() => demo?.projectPath ?? null);
  const [ready, setReady] = useState(Boolean(demo));

  useEffect(() => {
    if (demo) return;
    void (async () => {
      try {
        const settings = await loadSettings();
        const fromRegistry = (await tauri.getProjectPath()) || null;
        const path = settings.project_path ?? fromRegistry;
        if (isValidProjectPath(path)) {
          await tauri.setProjectPath(path);
          const resolved = await tauri.getProjectPath();
          setProjectPathState(resolved);
          if (settings.project_path !== resolved) {
            await saveSettings({ ...settings, project_path: resolved });
          }
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
    const settings = await loadSettings();
    await saveSettings({ ...settings, project_path: resolved });
    setProjectPathState(resolved);
  }, [demo]);

  return { projectPath: demo?.projectPath ?? projectPath, setProjectPath, ready };
}
