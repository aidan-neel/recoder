import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { embedWebVite } from '../web/embed-web-vite';

const config = embedWebVite(import.meta.url, [tailwindcss(), sveltekit()]);

/** A fixed port beside apps/web (5173) and the site (5174), so all three run side by side. */
export default defineConfig({ ...config, server: { ...config.server, port: 5180, strictPort: true } });
