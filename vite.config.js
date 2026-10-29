import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base relativa para que funcione en GitHub Pages (https://<user>.github.io/<repo>/)
export default defineConfig({
  base: './',
  plugins: [react()],
})
