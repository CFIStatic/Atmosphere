/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Atmosphere runs warm and light: paper surfaces, ink text, a single
         * terracotta accent. The accent is load-bearing — it marks the one
         * action on a screen that commits something — so it is used sparingly
         * and never for decoration.
         */
        brand: {
          50: '#FDF4EE',
          100: '#FAE5D6',
          200: '#F4C8A9',
          300: '#EBA475',
          400: '#DF7B44',
          500: '#D2500A',
          600: '#BC4508',
          700: '#993607',
          800: '#772B06',
          900: '#5B2104',
        },
        /** Surfaces, lightest first. `0` is card white, `100` is the page. */
        paper: {
          0: '#FFFFFF',
          50: '#FBFAF7',
          100: '#F4F1EB',
          200: '#EDE9E1',
          300: '#E4DFD5',
          400: '#D8D2C5',
        },
        /** Text, darkest first. Warm greys — pure neutral looks cold on paper. */
        ink: {
          900: '#1C1917',
          800: '#292524',
          700: '#44403C',
          600: '#57534E',
          500: '#78716C',
          400: '#A8A29E',
        },
        /** Hairlines. A separate token so borders tune in one place. */
        line: {
          DEFAULT: '#E3DED4',
          strong: '#D3CCBE',
        },
        /** Status. Muted enough to sit on paper without shouting. */
        danger: { 50: '#FDF2F0', 200: '#F3C7BF', 600: '#B4361D', 700: '#8F2A15' },
        caution: { 50: '#FDF7EC', 200: '#EFDCAF', 600: '#946A0B' },
        success: { 50: '#F0F7F1', 200: '#BEDCC3', 600: '#3F7D4C' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        /** The only two elevations. Soft and warm, never a hard grey drop. */
        card: '0 1px 2px rgba(28, 25, 23, 0.04), 0 1px 3px rgba(28, 25, 23, 0.03)',
        lift: '0 4px 12px rgba(28, 25, 23, 0.07), 0 2px 4px rgba(28, 25, 23, 0.04)',
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
