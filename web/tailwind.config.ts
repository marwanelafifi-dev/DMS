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
        serif: ['"Merriweather"', 'Georgia', 'serif'],
        mono: ['"Fira Code"', '"SF Mono"', 'Monaco', '"Cascadia Code"', 'Consolas', '"Courier New"', 'monospace'],
      },
      colors: {
        primary: {
          50: '#f0f6fb',
          100: '#e0eef8',
          200: '#c2ddf1',
          300: '#a3ccea',
          400: '#84bbe3',
          500: '#4EBDD6',
          600: '#3DA8C4',
          700: '#2C93B2',
          800: '#1B7EA0',
          900: '#0D2B4A',
        },
        navy: {
          50: '#f5f7fb',
          100: '#eaeff7',
          200: '#d6dff0',
          300: '#c2cfe8',
          400: '#adbfe1',
          500: '#0D2B4A',
          600: '#0c2642',
          700: '#0b213a',
          800: '#0a1c32',
          900: '#08172a',
        },
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#4EBDD6',
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
    },
  },
  plugins: [animate],
}

export default config
