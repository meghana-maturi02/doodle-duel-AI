// Open postcss.config.js, delete contents, and paste this exact layout:
export default {
  plugins: {
    '@tailwindcss/postcss': {}, // 🛠️ Updates the driver name to match Tailwind v4 specifications natively
    autoprefixer: {},
  },
}
