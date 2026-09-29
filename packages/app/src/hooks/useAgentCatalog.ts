import type { AgentCatalog } from '@loomria/shared';
import { emptyAgentCatalog } from '@loomria/shared';
import { useEffect, useState } from 'react';
import { tauri } from '../lib/tauri';

export function useAgentCatalog(): AgentCatalog {
  const [catalog, setCatalog] = useState<AgentCatalog>(emptyAgentCatalog);

  useEffect(() => {
    void tauri.listAgents().then(setCatalog);
  }, []);

  return catalog;
}
