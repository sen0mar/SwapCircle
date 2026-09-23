import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { initializeTheme } from './src/theme/theme';

export default defineConfig({
  optimizeDeps: {
    // Workspace exports change without a lockfile change; serve them directly.
    exclude: ['@swapcircle/contracts'],
    include: [
      '@radix-ui/react-dialog',
      '@radix-ui/react-slot',
      '@tanstack/react-query',
      '@swapcircle/contracts > zod',
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
