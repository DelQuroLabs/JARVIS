import { defineConfig, type ServerOptions } from 'vite';
import react from '@vitejs/plugin-react';

// The sandbox preview is proxied under an *.e2b.app host, so host checks must be
// permissive and HMR must use the public TLS port. Do not "tidy" these away.
const server = {
  host: '0.0.0.0',
  port: 5173,
  strictPort: true,
  allowedHosts: true,
  hmr: { clientPort: 443 },
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
  },
} as unknown as ServerOptions;

export default defineConfig({
  plugins: [react()],
  server,
  preview: server,
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
