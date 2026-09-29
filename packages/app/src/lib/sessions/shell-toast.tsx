import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastItem = { id: number; message: string };

const ToastContext = createContext<{
  pushToast: (message: string) => void;
} | null>(null);

let nextId = 0;

export function ShellToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const pushToast = useCallback((message: string) => {
    const id = ++nextId;
    setItems((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[120] flex flex-col gap-2 pointer-events-none">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto rounded-md border border-border bg-elevated px-3 py-2 text-meta text-text shadow-lg"
            data-testid="shell-toast"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useShellToast(): { pushToast: (message: string) => void } {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { pushToast: () => {} };
  }
  return ctx;
}

export function pushShellToastQuiet(message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('loomria-shell-toast', { detail: message }));
}
