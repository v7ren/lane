import { describe, expect, it } from 'vitest';
import {
  buildComposerModelChoices,
  pickDefaultComposerModel,
  resolveConfiguredDefaultModel,
  resolveConfigModelPillLabel,
} from './provider-catalog';

describe('provider-catalog defaults', () => {
  const raw = {
    default: { deepinfra: 'zai-org/GLM-5.3-Flash', 'opencode-go': 'mimo-v2.5' },
    connected: ['opencode-go', 'deepinfra'],
    providers: [
      { id: 'opencode-go', name: 'OpenCode Go', models: { 'mimo-v2.5': { id: 'mimo-v2.5' } } },
      {
        id: 'deepinfra',
        name: 'DeepInfra',
        models: { 'zai-org/GLM-5.3-Flash': { id: 'zai-org/GLM-5.3-Flash' } },
      },
    ],
  };

  it('resolveConfiguredDefaultModel uses GET /config model field', () => {
    expect(resolveConfiguredDefaultModel({ model: 'opencode-go/mimo-v2.5' })).toEqual({
      providerID: 'opencode-go',
      modelID: 'mimo-v2.5',
    });
    expect(resolveConfigModelPillLabel({ model: 'opencode-go/mimo-v2.5' })).toBe('mimo-v2.5');
  });

  it('resolveConfiguredDefaultModel ignores /provider default map', () => {
    expect(resolveConfiguredDefaultModel(raw)).toBeNull();
  });

  it('pickDefaultComposerModel does not fall back to first connected model', () => {
    const emptyDefaults = { ...raw, default: {} };
    const choices = buildComposerModelChoices(emptyDefaults);
    expect(pickDefaultComposerModel(emptyDefaults, choices, null)).toBeNull();
  });

  it('pickDefaultComposerModel honors explicit hint only', () => {
    const choices = buildComposerModelChoices(raw, {
      current: { providerID: 'opencode-go', modelID: 'mimo-v2.5' },
    });
    const picked = pickDefaultComposerModel(raw, choices, {
      providerID: 'opencode-go',
      modelID: 'mimo-v2.5',
    });
    expect(picked?.providerID).toBe('opencode-go');
    expect(picked?.modelID).toBe('mimo-v2.5');
  });
});
