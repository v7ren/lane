const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  rs: 'rust',
  css: 'css',
  html: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
};

export function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? 'plaintext';
}
