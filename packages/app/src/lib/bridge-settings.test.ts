import { describe, expect, it } from 'vitest';
import { DEFAULT_PUBLIC_SETTINGS, toPublicSettings } from './bridge-settings';
import type { Settings } from '@loomria/shared';

describe('toPublicSettings', () => {
  it('strips secrets and keeps bridge-safe fields', () => {
    const settings: Settings = {
      ...DEFAULT_PUBLIC_SETTINGS,
      anthropic_api_key: 'secret',
      custom_models: [],
      sidebar_width: 360,
      theme: 'dark',
    };
    const pub = toPublicSettings(settings);
    expect(pub.default_provider).toBe('anthropic');
    expect(pub).not.toHaveProperty('anthropic_api_key');
  });
});
