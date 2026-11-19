import { join } from 'node:path';

/** Next exports one shell for each app. Navigation reads the address in the browser, including on deep links. */
export function bundledApp(directory: string): (request: Request, pathname: string) => Response | undefined {
	const files = new Set(new Bun.Glob('**/*').scanSync({ cwd: directory, onlyFiles: true }));

	if (!files.has('index.html') || !files.has('sample.html')) {
		throw new Error('RECODER_APP_DIR must point to the exported app with index.html and sample.html.');
	}

	return (request, pathname) => {
		if (request.method !== 'GET' && request.method !== 'HEAD') return;

		let path: string;

		try {
			path = decodeURIComponent(pathname);
		} catch {
			return;
		}

		if (/^\/(?:api|health)(?:\/|$)/.test(path)) return;

		let file = path.slice(1);

		if (!files.has(file)) {
			if (path.startsWith('/_next/') || !isPageRequest(request, path)) return;

			file = /^\/sample(?:\/|$)/.test(path) ? 'sample.html' : 'index.html';
		}

		const body = Bun.file(join(directory, file));
		const cache = file.startsWith('_next/static/') ? 'public, max-age=31536000, immutable' : 'no-cache';

		return new Response(request.method === 'HEAD' ? null : body, {
			headers: { 'Content-Type': body.type, 'Content-Length': String(body.size), 'Cache-Control': cache }
		});
	};
}

function isPageRequest(request: Request, path: string): boolean {
	return (
		path === '/' ||
		path === '/sample' ||
		path === '/sample/' ||
		(request.headers.get('accept')?.includes('text/html') ?? false)
	);
}
