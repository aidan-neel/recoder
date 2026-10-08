import adapter from '@sveltejs/adapter-vercel';
import { embedWebConfig } from '../web/embed-web.js';

/**
 * Deployed to Vercel: pages are prerendered and /api/waitlist runs as a
 * function. The site renders the app's own components and styles through
 * `$web`, so the two never drift.
 */
export default embedWebConfig({ adapter: adapter() });
