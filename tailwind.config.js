/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#facc15',
        'primary-light': '#f8f3e8',
        'bg-window': '#f8f7f4',
        'surface-muted': '#f8f7f4',
        'text-main': '#1e2a38',
        'text-muted': '#64748b',
        'border-soft': '#e5e7eb'
      },
      borderRadius: {
        app: '20px'
      },
      boxShadow: {
        card: '0 18px 36px rgba(15, 23, 42, 0.1)'
      }
    }
  },
  plugins: []
};
