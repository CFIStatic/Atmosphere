/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Brand ────────────────────────────────────────────────────────────
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },

        // ── Surfaces ─────────────────────────────────────────────────────────
        // 900 is the app canvas; each step up is one elevation level.
        ink: {
          950: '#06060c',
          900: '#0a0a12',
          800: '#12121d',
          700: '#1b1b2b',
          600: '#262639',
          500: '#343349',
        },

        // ── Semantic state ───────────────────────────────────────────────────
        // Everything status-, risk-, or execution-related resolves through these
        // names rather than raw colours, so restyling the product is a change to
        // this block alone. Never use `text-emerald-400` in a component.
        state: {
          ok: '#34d399', // healthy, completed, on-track
          info: '#38bdf8', // informational, scheduled
          warn: '#fbbf24', // needs attention, at-risk
          danger: '#f87171', // blocked, failed, overdue
          running: '#a78bfa', // agent actively executing
          idle: '#94a3b8', // inactive, draft, none
        },
      },

      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      fontSize: {
        // Operational density: a dedicated micro size for table meta and labels.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },

      spacing: {
        // Fixed shell dimensions, referenced by layout and by scroll offsets.
        nav: '15rem',
        'nav-collapsed': '3.75rem',
        assistant: '23rem',
        topbar: '3.5rem',
      },

      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        // Feedback for a rejected PIN — carries the same meaning as the error
        // text for users who are scanning rather than reading.
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-7px)' },
          '40%, 80%': { transform: 'translateX(7px)' },
        },
        // Slow, low-contrast pulse for "an agent is working on this". Deliberately
        // understated — this fires on live operational screens all day.
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },

      animation: {
        'fade-in-up': 'fade-in-up 0.5s ease-out both',
        'fade-in': 'fade-in 0.2s ease-out both',
        'slide-in-right': 'slide-in-right 0.22s cubic-bezier(0.32, 0.72, 0, 1) both',
        shake: 'shake 0.4s ease-in-out',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
