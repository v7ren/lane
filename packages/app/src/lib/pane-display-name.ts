import { getPreset, type AgentCatalog } from '@loomria/shared';
import type { PaneData } from '../hooks/usePaneRegistry';

function cwdBasename(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : null;
}

/** Human-readable session title; disambiguates duplicate agent types. */
export function buildPaneDisplayNames(
  panes: PaneData[],
  agentCatalog: AgentCatalog,
  overrides?: Map<string, string>,
): Map<string, string> {
  const byAgent = new Map<string, PaneData[]>();
  for (const pane of panes) {
    const list = byAgent.get(pane.info.agent_type) ?? [];
    list.push(pane);
    byAgent.set(pane.info.agent_type, list);
  }

  const titles = new Map<string, string>();
  for (const pane of panes) {
    const override = overrides?.get(pane.info.id);
    if (override) {
      titles.set(pane.info.id, override);
      continue;
    }

    const base = getPreset(agentCatalog, pane.info.agent_type)?.label ?? pane.info.agent_type;
    const siblings = byAgent.get(pane.info.agent_type) ?? [pane];
    if (siblings.length === 1) {
      titles.set(pane.info.id, base);
      continue;
    }

    const cwdHint = cwdBasename(pane.info.cwd);
    const index = siblings.findIndex((p) => p.info.id === pane.info.id) + 1;
    const siblingHints = siblings
      .map((p) => cwdBasename(p.info.cwd))
      .filter((h): h is string => Boolean(h));
    const basenamesUnique =
      siblingHints.length === siblings.length &&
      new Set(siblingHints).size === siblingHints.length;
    if (cwdHint && basenamesUnique) {
      titles.set(pane.info.id, `${base} · ${cwdHint}`);
    } else {
      titles.set(pane.info.id, `${base} · ${index}`);
    }
  }
  return titles;
}
