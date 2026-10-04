import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { initializeTheme } from './src/theme/theme';

export default defineConfig({
  // Controlled releases supply an allowlist explicitly; never load local dotenv files.
  ...(process.env.SWAPCIRCLE_RELEASE_BUILD === '1'
    ? { envDir: false as const }
    : {}),
  build: {
    sourcemap: process.env.SENTRY_SOURCE_MAPS === '1' ? 'hidden' : false,
  },
  resolve: {
    // Read workspace contracts directly so a running dev server never serves stale dist output.
    alias: {
      '@swapcircle/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    // Workspace exports change without a lockfile change; serve them directly.
    exclude: ['@swapcircle/contracts'],
    // Keep the first dependency graph stable: late discovery can invalidate
    // React/router chunks already requested by a cold browser (optimizer 504s).
    noDiscovery: true,
    include: [
      '@hookform/resolvers/zod',
      '@radix-ui/react-dialog',
      '@radix-ui/react-slot',
      '@supabase/supabase-js',
      '@sentry/react',
      '@tanstack/react-query',
      '@swapcircle/contracts > zod',
      'lucide-react',
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom/client',
      'react-hook-form',
      'react-router-dom',
    ],
  },
  plugins: [
    {
      name: 'theme-before-paint',
      transformIndexHtml: {
        order: 'pre',
        handler: () => [
          {
            tag: 'script',
            children: `(${initializeTheme.toString()})()`,
            injectTo: 'head-prepend',
          },
        ],
      },
    },
    react(),
    tailwindcss(),
  ],
});
