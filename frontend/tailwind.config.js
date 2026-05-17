/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
      },
      colors: {
        dark: {
          950: '#070708',
          900: '#0B0B0D',
          800: '#141417',
          700: '#1F1F24',
        },
        brand: {
          300: '#F2E3C6',
          400: '#EAD2A8',
          500: '#E2C999',
          600: '#D2B47C',
          700: '#B5945B',
        }
      },
      animation: {
        'pulse-slow': 'pulse 6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
