import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0d12',
        panel: '#11151c',
        panel2: '#161b24',
        line: '#1f2632',
        muted: '#8a93a6',
        text: '#e6e9ef',
        buy: '#22c55e',
        sell: '#ef4444',
        warn: '#f59e0b',
        big: '#facc15',
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace',
        ],
      },
      keyframes: {
        flashIn: {
          '0%': { backgroundColor: 'rgba(250, 204, 21, 0.18)' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
      animation: {
        flashIn: 'flashIn 1.6s ease-out 1',
      },
    },
  },
  plugins: [],
};

export default config;
