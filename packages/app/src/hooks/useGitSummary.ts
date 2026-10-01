import { useEffect, useState } from 'react';
import { isTauriRuntime } from '../lib/is-tauri';
import { tauri, type GitSummary } from '../lib/tauri';

const POLL_MS = 10_000;
const EMPTY: GitSummary = { branch: null, changed: 0 };

/** Branch and changed-file count for `cwd`; polls every 10 s while `visible`. Never throws. */
export function useGitSummary(cwd: string | null, visible = true): GitSummary {
  const [summary, setSummary] = useState<GitSummary>(EMPTY);

  useEffect(() => {
    if (!cwd || !visible || !isTauriRuntime()) {
      setSummary(EMPTY);
      return;
    }
    let cancelled = false;
    const load = () => {
      void tauri
        .gitStatusSummary(cwd)
        .then((next) => {
          if (cancelled) return;
          setSummary((prev) =>
            prev.branch === next.branch && prev.changed === next.changed ? prev : next,
          );
        })
        .catch(() => {
          if (!cancelled) setSummary(EMPTY);
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cwd, visible]);

  return summary;
}
