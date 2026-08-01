/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Atmosphere's console runs dark and warm: charcoal surfaces, warm
         * off-white ink, a single load-bearing orange accent. Token SEMANTICS
         * are unchanged — `paper` is still surfaces page-to-card, `ink` is
         * still text strongest-first, tint steps (50/100/200) are still
         * backgrounds and 600+ still reads on top of them — so every screen
         * written against the light palette reskins without edits.
         */
        brand: {
          50: '#31190C',
          100: '#3E1F0D',
          200: '#54290F',
          300: '#7C3A12',
          400: '#B54F10',
          500: '#E8590C',
          600: '#F26E22',
          700: '#F5883F',
          800: '#F8A263',
          900: '#FBC28E',
        },
        /** Surfaces, page first. `100` is the page, `0` is the raised panel. */
        paper: {
          0: '#1D1B18',
          50: '#191714',
          100: '#141311',
          200: '#242220',
          300: '#2C2A27',
          400: '#3A3733',
        },
        /** Text, strongest first. Warm greys — pure neutral looks dead on charcoal. */
        ink: {
          900: '#F1EFEB',
          800: '#E2DFD9',
          700: '#C3BFB7',
          600: '#A09C93',
          500: '#807C74',
          400: '#5C5951',
        },
        /** Hairlines. A separate token so borders tune in one place. */
        line: {
          DEFAULT: '#2A2825',
          strong: '#3B3833',
        },
        /** Status. Dark tints behind bright readable tones. */
        danger: { 50: '#301412', 200: '#54201B', 600: '#F07A62', 700: '#F49B87' },
        caution: { 50: '#2C230E', 200: '#4E3D16', 600: '#E5B84A' },
        success: { 50: '#12261A', 200: '#1E4229', 600: '#7CC98D' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        /** The only two elevations. Deep and soft, never a hard grey drop. */
        card: '0 1px 2px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.25)',
        lift: '0 6px 18px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.35)',
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
