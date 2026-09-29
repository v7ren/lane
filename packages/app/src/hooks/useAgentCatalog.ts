import type { AgentCatalog } from '@loomria/shared';
import { emptyAgentCatalog } from '@loomria/shared';
import { useEffect, useState } from 'react';
import { useDemoFixtures } from '../lib/demo/DemoContext';
import { tauri } from '../lib/tauri';

export function useAgentCatalog(): AgentCatalog {
  const demo = useDemoFixtures();
  const [catalog, setCatalog] = useState<AgentCatalog>(() => demo?.agentCatalog ?? emptyAgentCatalog());

  useEffect(() => {
    if (demo) return;
    void tauri.listAgents().then(setCatalog);
  }, [demo]);

  return demo?.agentCatalog ?? catalog;
}
