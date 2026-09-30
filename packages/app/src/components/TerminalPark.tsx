/** Off-screen parking lot for xterm wrappers when no in-flow host is active. */
export function TerminalPark() {
  return (
    <div
      id="loomria-terminal-park"
      data-terminal-park
      className="fixed overflow-hidden pointer-events-none opacity-0"
      style={{ left: -10_000, top: 0, width: 480, height: 320 }}
      aria-hidden
    />
  );
}
