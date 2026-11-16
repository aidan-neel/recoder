import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { MiddlewareHandler } from 'hono';

const zip = promisify(gzip);
const MIN_BYTES = 8192;
const CACHE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 24;

type Encoded = { source: Buffer; zipped: Promise<Buffer> };

/** An explicit gzip preference overrides the wildcard, including an explicit refusal. */
function acceptsGzip(header: string): boolean {
	const entries = header
		.toLowerCase()
		.split(',')
		.map((part) => {
			const [name, ...parameters] = part.trim().split(';');
			const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));

			return { name, q: quality ? Number(quality.trim().slice(2)) : 1 };
		});

	const preference = entries.find((entry) => entry.name === 'gzip') ?? entries.find((entry) => entry.name === '*');

	return preference !== undefined && preference.q > 0 && preference.q <= 1;
}

/**
 * Only buffered JSON is compressed; SSE and other streams never get consumed. Level one keeps cold compression
 * cheap. Equal bytes at a URL share their compression, including in flight; changed bytes are never served from
 * the old entry. The cache bounds retained input and compressed output together, without retaining credentials.
 */
export function jsonCompression(): MiddlewareHandler {
	const cache = new Map<string, Encoded>();
	let retained = 0;

	function remove(key: string): void {
		const entry = cache.get(key);

		if (entry) retained -= entry.source.byteLength * 2;
		cache.delete(key);
	}

	function encoded(key: string, source: Buffer): Promise<Buffer> {
		const hit = cache.get(key);

		if (hit?.source.equals(source)) {
			cache.delete(key);
			cache.set(key, hit);

			return hit.zipped;
		}

		remove(key);

		const zipped = zip(source, { level: 1 });
		const bytes = source.byteLength * 2;

		if (bytes <= CACHE_BYTES) {
			while (cache.size && (retained + bytes > CACHE_BYTES || cache.size >= MAX_ENTRIES)) {
				remove(cache.keys().next().value!);
			}

			retained += bytes;
			cache.set(key, { source, zipped });

			zipped.catch(() => {
				if (cache.get(key)?.zipped === zipped) remove(key);
			});
		}

		return zipped;
	}

	return async (c, next) => {
		await next();

		const response = c.res;

		if (
			c.req.method === 'HEAD' ||
			!response.body ||
			response.status === 206 ||
			response.headers.has('Content-Encoding') ||
			!/^application\/json\b/i.test(response.headers.get('Content-Type') ?? '') ||
			/(?:^|,)\s*no-transform\s*(?:,|$)/i.test(response.headers.get('Cache-Control') ?? '')
		)
			return;

		const vary = response.headers.get('Vary');

		if (vary !== '*' && !vary?.split(',').some((value) => value.trim().toLowerCase() === 'accept-encoding')) {
			c.header('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
		}

		if (!acceptsGzip(c.req.header('Accept-Encoding') ?? '')) return;

		const source = Buffer.from(await c.res.arrayBuffer());
		const zipped = source.byteLength >= MIN_BYTES ? await encoded(c.req.url, source) : source;
		const compressed = zipped.byteLength < source.byteLength ? zipped : source;
		const headers = c.res.headers;

		if (compressed.byteLength < source.byteLength) {
			headers.set('Content-Encoding', 'gzip');

			const etag = headers.get('ETag');

			if (etag && !etag.startsWith('W/')) headers.set('ETag', `W/${etag}`);
		}

		headers.set('Content-Length', String(compressed.byteLength));

		c.res = new Response(new Uint8Array(compressed), {
			status: response.status,
			statusText: response.statusText,
			headers
		});
	};
}
