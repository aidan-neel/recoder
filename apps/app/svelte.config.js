import adapter from '@sveltejs/adapter-node';
import { embedWebConfig } from '../web/embed-web.js';

/**
 * The agentic review surface. It shares apps/web's pure helpers (theme,
 * highlighter, hover layer) and static fonts through `$web`, but owns its
 * own tokens, styles and components.
 */
export default embedWebConfig({
	adapter: adapter(),
	files: { assets: '../web/static' }
});
