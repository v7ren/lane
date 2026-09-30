import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCENT_PALETTE,
  DEFAULT_ACCENT,
  applyAccent,
  hexToRgbTriplet,
  isValidAccent,
  normalizeAccent,
} from './theme-accent';

describe('theme-accent', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--color-accent');
  });

  it('validates hex colours', () => {
    expect(isValidAccent('#3B82F6')).toBe(true);
    expect(isValidAccent('#3b82f6')).toBe(true);
    expect(isValidAccent('3B82F6')).toBe(false);
    expect(isValidAccent('#fff')).toBe(false);
    expect(isValidAccent(undefined)).toBe(false);
    expect(isValidAccent(42)).toBe(false);
  });

  it('normalizes to uppercase or default', () => {
    expect(normalizeAccent('#ec4899')).toBe('#EC4899');
    expect(normalizeAccent('nope')).toBe(DEFAULT_ACCENT);
  });

  it('converts hex to an rgb triplet matching the CSS tokens', () => {
    expect(hexToRgbTriplet('#3B82F6')).toBe('59 130 246');
    expect(hexToRgbTriplet('#000000')).toBe('0 0 0');
    expect(hexToRgbTriplet('garbage')).toBe('59 130 246');
  });

  it('has a valid palette that includes the default', () => {
    expect(ACCENT_PALETTE.every((s) => isValidAccent(s.hex))).toBe(true);
    expect(ACCENT_PALETTE.some((s) => s.hex === DEFAULT_ACCENT)).toBe(true);
  });

  it('applies and clears the CSS variable', () => {
    const style = document.documentElement.style;
    applyAccent('#EC4899');
    expect(style.getPropertyValue('--color-accent')).toBe('236 72 153');
    applyAccent(undefined);
    expect(style.getPropertyValue('--color-accent')).toBe('');
    applyAccent('#22C55E');
    applyAccent(DEFAULT_ACCENT);
    expect(style.getPropertyValue('--color-accent')).toBe('');
  });
});
