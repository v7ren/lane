export function mirrorLayoutSessionKey(createdAt: number, cols: number, rows: number): string {
  return `${createdAt}:${cols}x${rows}`;
}
