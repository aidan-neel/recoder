import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { embedWebVite } from '../web/embed-web-vite';

export default defineConfig(embedWebVite(import.meta.url, [tailwindcss(), sveltekit()]));
