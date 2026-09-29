export function LoomMark({ className = 'w-10 h-10 text-text-3' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M8 12h24M8 20h24M8 28h24M14 8v24M26 8v24"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M14 12c4 0 8 2 8 8s-4 8-8 8M26 12c-4 0-8 2-8 8s4 8 8 8"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
