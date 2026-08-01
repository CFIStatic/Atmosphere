/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * All values live in src/index.css as CSS variables (R G B triplets):
         * dark set on :root, light set under [data-theme="light"]. Semantics
         * never change between themes — paper is surfaces page-to-card, ink
         * is text strongest-first, tints (50/100/200) are backgrounds and
         * 600+ reads on top of them — so screens never branch on the theme.
         */
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)', 100: 'rgb(var(--brand-100) / <alpha-value>)', 200: 'rgb(var(--brand-200) / <alpha-value>)', 300: 'rgb(var(--brand-300) / <alpha-value>)', 400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)', 600: 'rgb(var(--brand-600) / <alpha-value>)', 700: 'rgb(var(--brand-700) / <alpha-value>)', 800: 'rgb(var(--brand-800) / <alpha-value>)', 900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
        paper: {
          0: 'rgb(var(--paper-0) / <alpha-value>)', 50: 'rgb(var(--paper-50) / <alpha-value>)', 100: 'rgb(var(--paper-100) / <alpha-value>)', 200: 'rgb(var(--paper-200) / <alpha-value>)', 300: 'rgb(var(--paper-300) / <alpha-value>)', 400: 'rgb(var(--paper-400) / <alpha-value>)',
        },
        ink: {
          900: 'rgb(var(--ink-900) / <alpha-value>)', 800: 'rgb(var(--ink-800) / <alpha-value>)', 700: 'rgb(var(--ink-700) / <alpha-value>)', 600: 'rgb(var(--ink-600) / <alpha-value>)', 500: 'rgb(var(--ink-500) / <alpha-value>)', 400: 'rgb(var(--ink-400) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        danger: { 50: 'rgb(var(--danger-50) / <alpha-value>)', 200: 'rgb(var(--danger-200) / <alpha-value>)', 600: 'rgb(var(--danger-600) / <alpha-value>)', 700: 'rgb(var(--danger-700) / <alpha-value>)' },
        caution: { 50: 'rgb(var(--caution-50) / <alpha-value>)', 200: 'rgb(var(--caution-200) / <alpha-value>)', 600: 'rgb(var(--caution-600) / <alpha-value>)' },
        success: { 50: 'rgb(var(--success-50) / <alpha-value>)', 200: 'rgb(var(--success-200) / <alpha-value>)', 600: 'rgb(var(--success-600) / <alpha-value>)' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        /** The only two elevations, themed in index.css with the tokens. */
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Feedback for a rejected PIN — carries the same meaning as the error
        // text for users who are scanning rather than reading.
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-7px)' },
          '40%, 80%': { transform: 'translateX(7px)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.5s ease-out both',
        shake: 'shake 0.4s ease-in-out',
      },
    },
  },
  plugins: [],
};
