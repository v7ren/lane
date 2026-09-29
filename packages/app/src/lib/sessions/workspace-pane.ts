import type { PaneData } from '../../hooks/usePaneRegistry';
import { projectPathsEqual } from '../project-path';
import { isOpenCodePane } from './merge-sessions';

export function findOpenCodePaneForProject(
  panes: PaneData[],
  projectPath: string,
): PaneData | undefined {
  return panes.find((p) => isOpenCodePane(p) && projectPathsEqual(p.info.cwd, projectPath));
}
