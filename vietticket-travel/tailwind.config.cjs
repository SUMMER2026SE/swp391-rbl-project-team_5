/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        primary: '#00474d',
        'primary-container': '#006068',
        'on-primary': '#ffffff',
        secondary: '#00629d',
        'secondary-container': '#00a2fd',
        'secondary-fixed': '#cfe5ff',
        'on-secondary-fixed': '#001d33',
        tertiary: '#543a00',
        'tertiary-fixed-dim': '#ffba20',
        'tertiary-fixed': '#ffdea8',
        'on-tertiary-fixed-variant': '#5e4200',
        background: '#f8fafb',
        surface: '#f8fafb',
        'surface-bright': '#f8fafb',
        'surface-container': '#eceeef',
        'surface-container-low': '#f2f4f5',
        'surface-container-high': '#e6e8e9',
        'surface-container-lowest': '#ffffff',
        'on-surface': '#191c1d',
        'on-surface-variant': '#3f484a',
        'outline-variant': '#bec8ca',
        error: '#ba1a1a',
      },
    },
  },
  plugins: [],
}
