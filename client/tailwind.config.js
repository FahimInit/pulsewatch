import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        pw: {
          primary: '#7657e8',
          'primary-hover': '#6546d6',
          'primary-light': '#f1edff',
          bg: '#f7f8fc',
          surface: '#ffffff',
          border: '#e9eaf0',
          text: '#202238',
          muted: '#9295a8',
          subtle: '#676a80',
          green: '#16a477',
          'green-bg': '#eaf8f2',
          red: '#e65362',
          'red-bg': '#fff0f1',
          orange: '#e69b40',
          'orange-bg': '#fff5e8',
          blue: '#4285dc',
          'blue-bg': '#edf4ff',
        },
      },
      borderRadius: {
        pw: '12px',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
