/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
      },
    },
  },
  plugins: [],
};
