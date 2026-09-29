type FsNode =
  | { kind: 'file'; content: string; mtimeMs: number }
  | { kind: 'directory'; children: Record<string, FsNode> };

const tree: { root: FsNode } = {
  root: {
    kind: 'directory',
    children: {
      README: {
        kind: 'file',
        content: '# Loomria demo\n\nEdit files in the explorer.\n',
        mtimeMs: Date.now() - 60_000,
      },
      src: {
        kind: 'directory',
        children: {
          'main.ts': {
            kind: 'file',
            content: "export function greet(name: string) {\n  return `hello ${name}`;\n}\n",
            mtimeMs: Date.now() - 30_000,
          },
          'app.tsx': {
            kind: 'file',
            content: "import React from 'react';\n\nexport function App() {\n  return <div>Loomria</div>;\n}\n",
            mtimeMs: Date.now() - 20_000,
          },
        },
      },
      'package.json': {
        kind: 'file',
        content: '{\n  "name": "loomria-demo"\n}\n',
        mtimeMs: Date.now() - 10_000,
      },
    },
  },
};

function splitPath(path: string): string[] {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean);
}

function getNode(path: string): FsNode | null {
  const parts = splitPath(path);
  let node: FsNode = tree.root;
  for (const part of parts) {
    if (node.kind !== 'directory') return null;
    const next = node.children[part];
    if (!next) return null;
    node = next;
  }
  return node;
}

function parentDir(path: string): { parent: FsNode & { kind: 'directory' }; name: string } | null {
  const parts = splitPath(path);
  if (parts.length === 0) return null;
  const name = parts[parts.length - 1]!;
  let node: FsNode = tree.root;
  for (const part of parts.slice(0, -1)) {
    if (node.kind !== 'directory') return null;
    node = node.children[part]!;
  }
  if (node.kind !== 'directory') return null;
  return { parent: node, name };
}

let demoFs: ReturnType<typeof createDemoFs> | null = null;

function createDemoFs() {
  return {
    listDir(rel: string) {
      const node = rel ? getNode(rel) : tree.root;
      if (!node || node.kind !== 'directory') return [];
      return Object.entries(node.children).map(([name, child]) => ({
        name,
        path: [...splitPath(rel), name].join('/'),
        kind: child.kind,
      }));
    },
    readFile(path: string) {
      const node = getNode(path);
      if (!node || node.kind !== 'file') throw new Error('not a file');
      return {
        content: node.content,
        encoding: 'utf-8',
        size: node.content.length,
        mtimeMs: node.mtimeMs,
      };
    },
    writeFile(path: string, content: string, expectedMtimeMs?: number | null) {
      const node = getNode(path);
      if (!node || node.kind !== 'file') throw new Error('not a file');
      if (expectedMtimeMs != null && node.mtimeMs !== expectedMtimeMs) {
        throw new Error('conflict: file changed on disk since it was read');
      }
      node.content = content;
      node.mtimeMs = Date.now();
      return { mtimeMs: node.mtimeMs, size: content.length };
    },
    walkFiles(query: string) {
      const q = query.toLowerCase();
      const out: string[] = [];
      const walk = (prefix: string, node: FsNode) => {
        if (node.kind === 'file') {
          const name = prefix.split('/').pop() ?? prefix;
          if (!q || name.toLowerCase().includes(q) || prefix.toLowerCase().includes(q)) {
            out.push(prefix);
          }
          return;
        }
        for (const [name, child] of Object.entries(node.children)) {
          walk(prefix ? `${prefix}/${name}` : name, child);
        }
      };
      walk('', tree.root);
      return out;
    },
    create(path: string, kind: 'file' | 'directory') {
      const parent = parentDir(path);
      if (!parent) {
        throw new Error('invalid path');
      }
      if (parent.parent.children[parent.name]) throw new Error('already exists');
      parent.parent.children[parent.name] =
        kind === 'directory'
          ? { kind: 'directory', children: {} }
          : { kind: 'file', content: '', mtimeMs: Date.now() };
    },
    rename(from: string, to: string) {
      const src = parentDir(from);
      const dst = parentDir(to);
      if (!src || !dst) throw new Error('invalid path');
      const node = src.parent.children[src.name];
      if (!node) throw new Error('missing');
      delete src.parent.children[src.name];
      dst.parent.children[dst.name] = node;
    },
    delete(path: string) {
      const parent = parentDir(path);
      if (!parent) throw new Error('invalid path');
      delete parent.parent.children[parent.name];
    },
    vcsDiff() {
      return [
        { path: 'src/main.ts', status: 'modified' as const },
        { path: 'README', status: 'modified' as const },
      ];
    },
    fileStatus() {
      return {
        'src/main.ts': 'M',
        README: 'M',
        'package.json': 'U',
      } as Record<string, string>;
    },
  };
}

export function getDemoFs() {
  if (!demoFs) demoFs = createDemoFs();
  return demoFs;
}
