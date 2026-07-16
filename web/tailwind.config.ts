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
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"Roboto"', '"Helvetica Neue"', 'Arial', 'sans-serif', ...defaultTheme.fontFamily.sans],
        mono: ['"SF Mono"', 'Monaco', '"Cascadia Code"', '"Roboto Mono"', 'Consolas', '"Courier New"', 'monospace'],
      },
      colors: {
        primary: {
          50: '#f0f5ff',
          100: '#e0ebff',
          200: '#c2d7ff',
          300: '#a3c3ff',
          400: '#84afff',
          500: '#5b9bff',
          600: '#4682e6',
          700: '#3a6dd9',
          800: '#2e58cc',
          900: '#1f3a8a',
        },
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#3b82f6',
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
        sm: '4px',
        md: '6px',
        lg: '8px',
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
    },
  },
  plugins: [animate],
}

export default config
