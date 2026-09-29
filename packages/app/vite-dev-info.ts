import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const DEV_INFO_PATH = resolve(__dirname, '../../loomria.dev.json');
const DEV_INFO_ROUTE = '/__loomria_dev__.json';

/** Optional local dev metadata (written by tooling when needed). */
export function devInfoPlugin(): Plugin {
  return {
    name: 'loomria-dev-info',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== DEV_INFO_ROUTE) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (!existsSync(DEV_INFO_PATH)) {
          res.statusCode = 404;
          res.end('{}');
          return;
        }
        res.end(readFileSync(DEV_INFO_PATH, 'utf8'));
      });
    },
  };
}
