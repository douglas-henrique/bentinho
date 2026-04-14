/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#111827',
        'primary-light': '#f3f4f6',
        'bg-window': '#e6f0f9',
        'surface-muted': '#f8fafc',
        'text-main': '#0f172a',
        'text-muted': '#64748b',
        'border-soft': '#dbe4ef'
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
