import adapter from '@sveltejs/adapter-node';
import { embedWebConfig } from '../web/embed-web.js';

/**
 * A local devtool for benchmark runs; it never deploys. It renders the app's
 * own styles, components and static fonts through `$web`, and reads the
 * server's report types and its eval HTTP client through `$server`.
 */
export default embedWebConfig({
	adapter: adapter(),
	files: { assets: '../web/static' },
	alias: { $server: '../server/src' }
});
