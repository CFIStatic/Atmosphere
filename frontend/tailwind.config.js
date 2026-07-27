/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Atmosphere brand palette — the orange from the logo mark, stepped for
        // UI use. 500 is the brand colour itself; 600 is the interactive step
        // that carries white text at an accessible contrast.
        brand: {
          50: '#fef4ee',
          100: '#fde4d4',
          200: '#fbc6a7',
          300: '#f8a377',
          400: '#f5854b',
          500: '#f26522', // brand orange
          600: '#dc5312',
          700: '#b5420e',
          800: '#8c330b',
          900: '#6b2708',
        },
        // Warm neutrals matching the brand canvas. ink-800 is the card and chart
        // surface, and is the exact surface the chart palette was validated
        // against — changing it means re-running the validator.
        ink: {
          900: '#121212',
          800: '#1a1a1a',
          700: '#242424',
          600: '#303030',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
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
