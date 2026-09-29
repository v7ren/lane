/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        body: ['13px', { lineHeight: '1.45' }],
        meta: ['12px', { lineHeight: '1.4' }],
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        pill: '9999px',
      },
      transitionDuration: {
        ui: '120ms',
      },
      colors: {
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        elevated: 'rgb(var(--color-elevated) / <alpha-value>)',
        hover: 'rgb(var(--color-hover) / <alpha-value>)',
        'border-subtle': 'rgb(var(--color-border-subtle) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        text: 'rgb(var(--color-text) / <alpha-value>)',
        'text-2': 'rgb(var(--color-text-2) / <alpha-value>)',
        'text-3': 'rgb(var(--color-text-3) / <alpha-value>)',
        'text-4': 'rgb(var(--color-text-4) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        link: 'rgb(var(--color-link) / <alpha-value>)',
        status: {
          approval: 'rgb(var(--color-status-approval) / <alpha-value>)',
          working: 'rgb(var(--color-status-working) / <alpha-value>)',
          rate: 'rgb(var(--color-status-rate) / <alpha-value>)',
          error: 'rgb(var(--color-status-error) / <alpha-value>)',
          done: 'rgb(var(--color-status-done) / <alpha-value>)',
          idle: 'rgb(var(--color-status-idle) / <alpha-value>)',
        },
        lr: {
          bg: 'rgb(var(--lr-bg) / <alpha-value>)',
          panel: 'rgb(var(--lr-panel) / <alpha-value>)',
          raised: 'rgb(var(--lr-raised) / <alpha-value>)',
          border: 'rgb(var(--lr-border) / <alpha-value>)',
          accent: 'rgb(var(--lr-accent) / <alpha-value>)',
          ok: 'rgb(var(--lr-ok) / <alpha-value>)',
          warn: 'rgb(var(--lr-warn) / <alpha-value>)',
          err: 'rgb(var(--lr-err) / <alpha-value>)',
          info: 'rgb(var(--lr-info) / <alpha-value>)',
          muted: 'rgb(var(--lr-muted) / <alpha-value>)',
          text: 'rgb(var(--lr-text) / <alpha-value>)',
        },
        pm: {
          bg: 'rgb(var(--pm-bg) / <alpha-value>)',
          panel: 'rgb(var(--pm-panel) / <alpha-value>)',
          raised: 'rgb(var(--pm-raised) / <alpha-value>)',
          border: 'rgb(var(--pm-border) / <alpha-value>)',
          accent: 'rgb(var(--pm-accent) / <alpha-value>)',
          ok: 'rgb(var(--pm-ok) / <alpha-value>)',
          warn: 'rgb(var(--pm-warn) / <alpha-value>)',
          err: 'rgb(var(--pm-err) / <alpha-value>)',
          muted: 'rgb(var(--pm-muted) / <alpha-value>)',
          text: 'rgb(var(--pm-text) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [
    function ({ addComponents }) {
      addComponents({
        '.text-section-label': {
          fontSize: '11px',
          lineHeight: '1.3',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: '500',
        },
      });
    },
  ],
};
