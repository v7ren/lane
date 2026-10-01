import type { AgentFamily } from '../../lib/agent-capabilities';

const FAMILY_MARKS: Record<AgentFamily, { letter: string; bg: string }> = {
  claude: { letter: 'C', bg: '#D97757' },
  codex: { letter: 'X', bg: '#8B5CF6' },
  opencode: { letter: 'O', bg: '#3B82F6' },
  other: { letter: '·', bg: '#999999' },
};

export function AgentMark({
  family,
  size = 'md',
}: {
  family: AgentFamily;
  size?: 'sm' | 'md';
}) {
  const mark = FAMILY_MARKS[family];
  const sizeClass = size === 'sm' ? 'w-3.5 h-3.5 text-[9px]' : 'w-5 h-5 text-[11px]';
  const agentName = family.charAt(0).toUpperCase() + family.slice(1);

  return (
    <span
      className={`inline-flex items-center justify-center rounded font-semibold text-white shrink-0 ${sizeClass}`}
      style={{ backgroundColor: mark.bg }}
      aria-label={agentName}
    >
      {mark.letter}
    </span>
  );
}
