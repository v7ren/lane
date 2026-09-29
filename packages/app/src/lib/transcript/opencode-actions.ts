import { opencodeClient } from '../opencode/client.js';

export async function findProjectFiles(paneId: string, query: string, limit = 20) {
  return opencodeClient.findFiles(paneId, { query, limit: String(limit) }) as Promise<
    { path: string; name?: string }[]
  >;
}

export { opencodeClient };
