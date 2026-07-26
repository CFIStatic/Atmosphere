/** @type {import('tailwindcss').Config} */

// Every colour resolves through a CSS variable defined in index.css, so the two
// themes share one token set. Components never name a raw colour.
const withAlpha = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // ── Surfaces, ascending by elevation ─────────────────────────────────
        canvas: withAlpha('--canvas'),
        sunken: withAlpha('--sunken'),
        surface: withAlpha('--surface'),
        raised: withAlpha('--raised'),
        'raised-2': withAlpha('--raised-2'),

        // ── Text ─────────────────────────────────────────────────────────────
        fg: {
          DEFAULT: withAlpha('--fg'),
          2: withAlpha('--fg-2'),
          3: withAlpha('--fg-3'),
          4: withAlpha('--fg-4'),
        },

        // Hairlines and hover fills. White on dark, black on light — always
        // used with an explicit opacity, e.g. `border-line/10`.
        line: withAlpha('--line'),

        scrim: withAlpha('--scrim'),
        'on-accent': withAlpha('--on-accent'),

        // ── Accent: the orange bar from the mark ─────────────────────────────
        // 300 and 400 are variable because accent *text* has to darken on the
        // off-white ground to stay readable; the fills are constant.
        brand: {
          50: '#fdf3ee',
          100: '#fbe1d3',
          200: '#f8c3a7',
          300: withAlpha('--brand-300'),
          400: withAlpha('--brand-400'),
          500: '#f26522',
          600: '#dd5412',
          700: '#b6420e',
          800: '#8e340b',
          900: '#5f2307',
        },

        // ── Semantic state ───────────────────────────────────────────────────
        state: {
          ok: withAlpha('--ok'),
          info: withAlpha('--info'),
          warn: withAlpha('--warn'),
          danger: withAlpha('--danger'),
          running: withAlpha('--running'),
          idle: withAlpha('--idle'),
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
