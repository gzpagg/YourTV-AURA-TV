import { defineConfig } from 'vite';

// GitHub Pages uses /-/; local Windows installs keep the default site root.
export default defineConfig({
  base: process.env.APP_BASE_PATH || '/',
});
