import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// In development the React app runs on :5173 and forwards API + WebSocket traffic to the Node server on :4000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // lets your phone on the same Wi-Fi open the dashboard too
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
})
