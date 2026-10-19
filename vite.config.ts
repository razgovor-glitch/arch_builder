import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { designerMiddleware } from './server/designer';

/** Serves the Claude designer endpoint from the dev and preview servers, keeping the API key server-side. */
function designerApi(): Plugin {
  return {
    name: 'arch-builder-designer-api',
    configureServer(server) {
      server.middlewares.use('/api/designer', (req, res, next) => void designerMiddleware(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/designer', (req, res, next) => void designerMiddleware(req, res, next));
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make ANTHROPIC_API_KEY & co. from .env visible to the server-side designer (never to the client bundle).
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ARCH_BUILDER_MODEL', 'ARCH_BUILDER_EFFORT']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }
  return {
    plugins: [react(), designerApi()],
    server: { port: 5173 },
  };
});
