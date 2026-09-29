import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildComposerModelChoices,
  filterComposerModelChoices,
  pickDefaultComposerModel,
} from './provider-catalog';

const fixture = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__/provider-catalog-1.18.json'),
    'utf8',
  ),
) as {
  providerEndpoint: unknown;
  configProvidersEndpoint: unknown;
};

describe('provider-catalog', () => {
  it('parses OpenCode 1.18 /provider shape with models as Record', () => {
    const choices = buildComposerModelChoices(fixture.providerEndpoint, {
      current: { providerID: 'opencode-go', modelID: 'mimo-v2.5' },
    });
    expect(choices.length).toBeGreaterThan(0);
    expect(choices.some((c) => c.modelID === 'mimo-v2.5' && c.providerID === 'opencode-go')).toBe(
      true,
    );
    const mimo = choices.find((c) => c.modelID === 'mimo-v2.5');
    expect(mimo?.isCurrent).toBe(true);
    expect(mimo?.connected).toBe(true);
    expect(choices[0]?.connected).toBe(true);
  });

  it('parses /config/providers shape', () => {
    const choices = buildComposerModelChoices(fixture.configProvidersEndpoint);
    expect(choices).toHaveLength(1);
    expect(choices[0]?.modelID).toBe('mimo-v2.5');
  });

  it('filters by model id and provider', () => {
    const choices = buildComposerModelChoices(fixture.providerEndpoint);
    const filtered = filterComposerModelChoices(choices, 'mimo');
    expect(filtered.every((c) => c.modelID.includes('mimo') || c.modelName.toLowerCase().includes('mimo'))).toBe(
      true,
    );
  });

  it('does not treat /provider wrapper keys as providers', () => {
    const choices = buildComposerModelChoices(fixture.providerEndpoint);
    expect(choices.some((c) => c.providerID === 'default')).toBe(false);
    expect(choices.some((c) => c.providerID === 'connected')).toBe(false);
  });

  it('pickDefaultComposerModel prefers session hint', () => {
    const choices = buildComposerModelChoices(fixture.providerEndpoint);
    const picked = pickDefaultComposerModel(fixture.providerEndpoint, choices, {
      providerID: 'opencode-go',
      modelID: 'deepseek-v4-pro',
    });
    expect(picked?.modelID).toBe('deepseek-v4-pro');
  });
});
