import type { Config } from 'tailwindcss'
import defaultTheme from 'tailwindcss/defaultTheme'
import animate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"Helvetica Neue"', 'Arial', 'sans-serif', ...defaultTheme.fontFamily.sans],
        serif: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"Fira Code"', '"SF Mono"', 'Monaco', '"Cascadia Code"', 'Consolas', '"Courier New"', 'monospace'],
      },
      colors: {
        navy: {
          50: '#f0f4f9',
          100: '#e0e9f3',
          200: '#c1d2e7',
          300: '#a2bbdb',
          400: '#6d92bf',
          500: '#38699f',
          600: '#1a4d80',
          700: '#0d3a63',
          800: '#063349',
          900: '#002E5C',
          950: '#0a0c10',
        },
        cyan: {
          50: '#f0fafb',
          100: '#e0f5f8',
          200: '#c1ebf1',
          300: '#a2e1ea',
          400: '#64c3eb',
          500: '#2d9dcf',
          600: '#0082a8',
          700: '#006d91',
          800: '#005878',
          900: '#00A8D8',
        },
      },
      spacing: {
        'sidebar-width': '280px',
        'navbar-height': '64px',
        'navbar-height-mobile': '48px',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '300ms',
        slow: '500ms',
      },
      borderRadius: {
        xs: '2px',
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        sm: '0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px 0 rgba(0, 0, 0, 0.04)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'skeleton': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'skeleton': 'skeleton 2s infinite',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #002E5C 0%, #063349 100%)',
      },
    },
  },
  plugins: [animate],
}

export default config
