/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: "#3a3a3a",
          blue: "#044780",
          yellow: "#fdb913",
          panel: "#fafafa",
          gold: "#f7b714",
          navy: "#012952",
          terminal: "#1a1a1a",
          "dark-hover": "#2a2a2a",
          "blue-hover": "#033660",
        }
      }
    },
  },
  plugins: [],
}