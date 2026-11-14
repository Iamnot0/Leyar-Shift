import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, projectRoot, ''), ...process.env };
  const proxy = { '/v1': { target: env.VITE_API_TARGET ?? 'http://localhost:8000', changeOrigin: true } };

  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  };
});
