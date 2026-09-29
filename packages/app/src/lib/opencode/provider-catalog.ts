export type ComposerModelChoice = {
  providerID: string;
  modelID: string;
  label: string;
  providerName: string;
  modelName: string;
  connected: boolean;
  isCurrent: boolean;
};

type RawModel = {
  id?: string;
  name?: string;
};

type RawProvider = {
  id?: string;
  name?: string;
  models?: Record<string, RawModel> | RawModel[];
};

function modelEntries(models: RawProvider['models']): { modelID: string; modelName: string }[] {
  if (!models) return [];
  if (Array.isArray(models)) {
    return models
      .map((m) => ({
        modelID: m.id ?? '',
        modelName: m.name ?? m.id ?? '',
      }))
      .filter((m) => m.modelID.length > 0);
  }
  return Object.entries(models).map(([key, m]) => ({
    modelID: m.id ?? key,
    modelName: m.name ?? m.id ?? key,
  }));
}

function normalizeProviderList(raw: unknown): RawProvider[] {
  if (Array.isArray(raw)) {
    return raw as RawProvider[];
  }
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.all)) {
    return obj.all as RawProvider[];
  }
  if (Array.isArray(obj.providers)) {
    return obj.providers as RawProvider[];
  }
  return [];
}

function connectedProviderIds(raw: unknown, providers: RawProvider[]): Set<string> {
  if (!raw || typeof raw !== 'object') {
    return new Set(providers.map((p) => p.id).filter(Boolean) as string[]);
  }
  const connected = (raw as { connected?: unknown }).connected;
  if (Array.isArray(connected)) {
    return new Set(connected.filter((id): id is string => typeof id === 'string' && id.length > 0));
  }
  return new Set(providers.map((p) => p.id).filter(Boolean) as string[]);
}

function defaultModelForProvider(
  raw: unknown,
  providerID: string,
): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const defaults = (raw as { default?: Record<string, string> }).default;
  const id = defaults?.[providerID];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export function buildComposerModelChoices(
  raw: unknown,
  options?: { current?: { providerID: string; modelID: string } | null },
): ComposerModelChoice[] {
  const providers = normalizeProviderList(raw);
  const connected = connectedProviderIds(raw, providers);
  const current = options?.current;

  const choices: ComposerModelChoice[] = [];
  for (const provider of providers) {
    const providerID = provider.id;
    if (!providerID) continue;
    const providerName = provider.name ?? providerID;
    const isConnected = connected.has(providerID);
    for (const { modelID, modelName } of modelEntries(provider.models)) {
      const isCurrent =
        current?.providerID === providerID && current?.modelID === modelID;
      choices.push({
        providerID,
        modelID,
        providerName,
        modelName,
        label: `${providerName} · ${modelName}`,
        connected: isConnected,
        isCurrent,
      });
    }
  }

  choices.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    const byProvider = a.providerName.localeCompare(b.providerName);
    if (byProvider !== 0) return byProvider;
    return a.modelName.localeCompare(b.modelName);
  });

  return choices;
}

export function filterComposerModelChoices(
  choices: ComposerModelChoice[],
  query: string,
): ComposerModelChoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return choices;
  return choices.filter(
    (c) =>
      c.modelID.toLowerCase().includes(q) ||
      c.modelName.toLowerCase().includes(q) ||
      c.providerID.toLowerCase().includes(q) ||
      c.providerName.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q),
  );
}

export function pickDefaultComposerModel(
  raw: unknown,
  choices: ComposerModelChoice[],
  hint?: { providerID: string; modelID: string } | null,
): ComposerModelChoice | null {
  if (hint) {
    const exact = choices.find(
      (c) => c.providerID === hint.providerID && c.modelID === hint.modelID,
    );
    if (exact) return exact;
  }
  const current = choices.find((c) => c.isCurrent);
  if (current) return current;
  const providers = normalizeProviderList(raw);
  for (const provider of providers) {
    const providerID = provider.id;
    if (!providerID) continue;
    const defaultModel = defaultModelForProvider(raw, providerID);
    if (defaultModel) {
      const hit = choices.find((c) => c.providerID === providerID && c.modelID === defaultModel);
      if (hit) return hit;
    }
  }
  return choices.find((c) => c.connected) ?? choices[0] ?? null;
}
