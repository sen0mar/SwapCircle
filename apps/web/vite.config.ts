import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { initializeTheme } from './src/theme/theme';

export default defineConfig({
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
