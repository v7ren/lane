import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { DemoVariant } from '../demo-mode';
import { buildDemoFixtures, type DemoFixtures } from './fixtures';

const DemoContext = createContext<DemoFixtures | null>(null);

export function DemoProvider({ variant, children }: { variant: DemoVariant; children: ReactNode }) {
  const value = useMemo(() => buildDemoFixtures(variant), [variant]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemoFixtures(): DemoFixtures | null {
  return useContext(DemoContext);
}
