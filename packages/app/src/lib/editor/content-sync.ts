/**
 * The Monaco pane is uncontrolled after mount: React state lags fast typing, so feeding
 * `tab.content` back in as a prop would overwrite newer keystrokes with a stale value.
 * Content is pushed into the editor only when something outside it replaced the file
 * (a disk reload or re-open), which bumps the tab's `revision`.
 */
export function shouldApplyExternalContent(args: {
  revision: number;
  appliedRevision: number;
  tabContent: string;
  editorValue: string;
}): boolean {
  if (args.revision === args.appliedRevision) return false;
  return args.tabContent !== args.editorValue;
}
