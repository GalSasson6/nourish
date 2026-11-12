import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Machine-specific hosts live in the gitignored `.env`; see `.env.example`.
  const env = loadEnv(mode, process.cwd(), '');
  const apiHost = env.API_HOST || '127.0.0.1';
  const apiPort = env.PORT || '8787';
  const allowedHosts = (env.DEV_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            charts: ['recharts'],
            icons: ['lucide-react'],
          },
        },
      },
    },
    server: {
      host: env.DEV_HOST || 'localhost',
      port: 5173,
      allowedHosts,
      proxy: {
        '/api': `http://${apiHost}:${apiPort}`,
      },
    },
  };
});
