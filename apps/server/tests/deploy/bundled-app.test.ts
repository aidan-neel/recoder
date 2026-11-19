import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledApp } from '../../src/deploy/bundled-app';

let directory: string;
let fetchPage: ReturnType<typeof bundledApp>;

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'recoder-export-'));

	const root = join(directory, 'public');
	const assets = join(root, '_next/static');

	await mkdir(assets, { recursive: true });

	await Promise.all([
		writeFile(join(root, 'index.html'), 'live'),
		writeFile(join(root, 'sample.html'), 'sample'),
		writeFile(join(assets, 'chunk.js'), 'chunk'),
		writeFile(join(directory, 'private.txt'), 'private')
	]);

	fetchPage = bundledApp(root);
});

afterAll(async () => rm(directory, { recursive: true, force: true }));

function get(path: string, accept = 'text/html', method = 'GET'): Response | undefined {
	return fetchPage(new Request(`http://recoder.test${path}`, { method, headers: { accept } }), path);
}

test('a direct link chooses the live or sample shell after browser navigation', async () => {
	expect(await get('/repos/a.b/pulls/1')?.text()).toBe('live');
	expect(await get('/sample/repos/a.b/pulls/1')?.text()).toBe('sample');
	expect(await get('/sample-other')?.text()).toBe('live');
});

test('API and health requests always reach Hono, including with a document accept header', () => {
	for (const path of ['/api', '/api/missing', '/api%2Fmissing', '/health', '/health/ready']) {
		expect(get(path)).toBeUndefined();
	}

	expect(get('/sample', 'text/html', 'POST')).toBeUndefined();
});

test('only exported files are served and a missing script is not given an HTML shell', async () => {
	expect(await get('/_next/static/chunk.js', '*/*')?.text()).toBe('chunk');
	expect(get('/_next/static/missing.js')).toBeUndefined();
	expect(get('/..%2Fprivate.txt', '*/*')).toBeUndefined();
	expect(get('/sample', 'text/html', 'HEAD')?.body).toBeNull();
});
