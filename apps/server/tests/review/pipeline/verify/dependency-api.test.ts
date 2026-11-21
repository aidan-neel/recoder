import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import inspector from '../../../../src/review/pipeline/verify/dependency-api.inspector.js' with { type: 'text' };
import { dependencyProbe } from './dependency-probe';

let root: string;
let seq = 0;

interface Lookup {
	matches: {
		name: string;
		version: string;
		pinnedVersion?: string;
		files: { path: string; content: string; truncated: boolean; sha256OfReadBytes: string }[];
	}[];
	unavailable: { name: string; unavailable: string }[];
	bytesRead: number;
	limits: { outputBytes: number; totalReadBytes: number };
}

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'dependency-grounding-'));
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

async function fixture(files: Record<string, string>) {
	const dir = join(root, String(seq++));

	await mkdir(dir);
	await put(dir, 'package.json', JSON.stringify({ name: 'fixture' }));
	for (const [path, content] of Object.entries(files)) await put(dir, path, content);

	return dir;
}

async function put(dir: string, path: string, content: string) {
	await mkdir(dirname(join(dir, path)), { recursive: true });
	await writeFile(join(dir, path), content);
}

async function lookup(dir: string, file = 'a.ts', claim = '`S3.getObject()` is a missing API method') {
	const { output } = await dependencyProbe([process.execPath, '-e', inspector, JSON.stringify({ file, claim })], dir, {
		...process.env,
		GOMODCACHE: join(dir, 'gomod')
	});

	const result = JSON.parse(output) as Lookup;

	expect(Buffer.byteLength(output)).toBeLessThanOrEqual(result.limits.outputBytes + 1);
	expect(result.bytesRead).toBeLessThanOrEqual(result.limits.totalReadBytes);

	return result;
}

const source = "import {S3} from '@aws-sdk/client-s3';";

const pkg = JSON.stringify({
	name: '@aws-sdk/client-s3',
	version: '3.750.0',
	exports: { '.': { types: './types/index.d.ts', default: './never.js' } }
});

test('installed exact versions and conditional declaration reexports ground aggregated client methods without executing packages', async () => {
	const dir = await fixture({
		'a.ts': source,
		'node_modules/@aws-sdk/client-s3/package.json': pkg,
		'node_modules/@aws-sdk/client-s3/types/index.d.ts': "export {S3} from './S3';",
		'node_modules/@aws-sdk/client-s3/types/S3.d.ts':
			'export class S3 { getObject(input: GetObjectInput): Promise<Result>; }',
		'node_modules/@aws-sdk/client-s3/never.js': 'throw new Error("package code must never execute")',
		'package-lock.json': JSON.stringify({ packages: { 'node_modules/@aws-sdk/client-s3': { version: '3.750.0' } } })
	});

	const result = await lookup(dir);

	expect(result.matches).toHaveLength(1);
	expect(result.matches[0]).toMatchObject({ version: '3.750.0', pinnedVersion: '3.750.0' });
	expect(result.matches[0].files.some((file) => file.content.includes('getObject(input:'))).toBe(true);
	expect(result.matches[0].files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256OfReadBytes))).toBe(true);
});

test('nearest node_modules and exported subpaths win over a different root installation', async () => {
	const dir = await fixture({
		'packages/a/a.ts': "import {Thing} from 'dep/feature';",
		'node_modules/dep/package.json': JSON.stringify({ name: 'dep', version: '1.0.0', types: 'index.d.ts' }),
		'node_modules/dep/index.d.ts': 'export const wrongVersion: true;',
		'packages/a/node_modules/dep/package.json': JSON.stringify({
			name: 'dep',
			version: '2.0.0',
			exports: { './feature': { types: './feature.d.ts' } }
		}),
		'packages/a/node_modules/dep/feature.d.ts': 'export class Thing { call(): void; }'
	});

	const result = await lookup(dir, 'packages/a/a.ts', '`dep` API method `Thing.call()` is missing');

	expect(result.matches[0]).toMatchObject({ name: 'dep/feature', version: '2.0.0' });
	expect(result.matches[0].files[0].content).toContain('call()');
});

test.each(['9.0.0', null, { injected: 'x'.repeat(30000) }])(
	'mismatched or invalid lock metadata is unavailable rather than a guessed version: %j',
	async (version) => {
		const dir = await fixture({
			'a.ts': source,
			'node_modules/@aws-sdk/client-s3/package.json': pkg,
			'package-lock.json': JSON.stringify({ packages: { 'node_modules/@aws-sdk/client-s3': { version } } })
		});

		const result = await lookup(dir);

		expect(result.matches).toEqual([]);
		expect(result.unavailable[0].unavailable).toMatch(/version/i);
	}
);

test('missing dependencies never cause a global cache or network lookup', async () => {
	const dir = await fixture({ 'a.ts': source });
	const result = await lookup(dir);

	expect(result.matches).toEqual([]);
	expect(result.unavailable[0].unavailable).toContain('not installed');
});

test('self imports and malformed installed metadata do not masquerade as external version evidence', async () => {
	const dir = await fixture({
		'a.ts': "import {Thing} from 'fixture';",
		'node_modules/fixture/package.json': 'invalid json'
	});

	const result = await lookup(dir);

	expect(result.matches).toEqual([]);
	expect(result.unavailable[0].unavailable).toContain('this project');
});

test('Python distribution aliases and exact versions resolve to their own source and relative modules', async () => {
	const site = '.venv/lib/python3.12/site-packages';

	const dir = await fixture({
		'a.py': 'from PIL import Image',
		'requirements.txt': 'Pillow==11.0.0\n',
		[`${site}/pillow-11.0.0.dist-info/METADATA`]: 'Name: Pillow\nVersion: 11.0.0\n',
		[`${site}/pillow-11.0.0.dist-info/top_level.txt`]: 'PIL\n',
		[`${site}/PIL/__init__.py`]: 'from . import Image\n',
		[`${site}/PIL/Image.py`]: 'def open(file, mode="r"):\n    return file\n'
	});

	const result = await lookup(dir, 'a.py', '`Image.open()` API does not accept a mode argument');

	expect(result.matches[0]).toMatchObject({ name: 'PIL', version: '11.0.0', pinnedVersion: '11.0.0' });
	expect(result.matches[0].files.some((file) => file.content.includes('def open(file, mode='))).toBe(true);
	await put(dir, 'requirements.txt', 'Pillow==10.0.0\n');
	expect((await lookup(dir, 'a.py')).matches).toEqual([]);
});

test('ambiguous installed Python distribution versions are unavailable', async () => {
	const site = '.venv/lib/python3.12/site-packages';

	const dir = await fixture({
		'a.py': 'import dep',
		[`${site}/dep-1.0.dist-info/METADATA`]: 'Name: dep\nVersion: 1.0',
		[`${site}/dep-2.0.dist-info/METADATA`]: 'Name: dep\nVersion: 2.0',
		[`${site}/dep/__init__.py`]: 'def call(): pass'
	});

	const result = await lookup(dir, 'a.py');

	expect(result.matches).toEqual([]);
	expect(result.unavailable[0].unavailable).toContain('Ambiguous');
});

test('Go requires the exact escaped module version rather than whichever cache directory exists', async () => {
	const dir = await fixture({
		'a.go': 'package main\nimport "example.com/Owner/dep/sub"',
		'go.mod': 'module fixture\nrequire example.com/Owner/dep v1.2.3\n',
		'gomod/example.com/!owner/dep@v1.2.3/go.mod': 'module example.com/Owner/dep\n',
		'gomod/example.com/!owner/dep@v1.2.3/sub/api.go': 'package sub\nfunc Call(value string) {}',
		'gomod/example.com/!owner/dep@v9.0.0/go.mod': 'module example.com/Owner/dep\n'
	});

	const result = await lookup(dir, 'a.go', '`Call()` API method does not accept a string');

	expect(result.matches[0]).toMatchObject({ name: 'example.com/Owner/dep/sub', version: 'v1.2.3' });
	expect(result.matches[0].files[0].content).toContain('func Call(value string)');
});

test('Go versioned replacements resolve at the replacement version while local replacements stay unavailable', async () => {
	const dir = await fixture({
		'a.go': 'package main\nimport "example.com/dep"',
		'go.mod': 'module fixture\nrequire example.com/dep v1.0.0\nreplace example.com/dep => example.com/fork v2.0.0\n',
		'gomod/example.com/fork@v2.0.0/go.mod': 'module example.com/fork\n',
		'gomod/example.com/fork@v2.0.0/api.go': 'package dep\nfunc Call() {}'
	});

	expect((await lookup(dir, 'a.go')).matches[0].version).toBe('v2.0.0');
	await put(dir, 'go.mod', 'module fixture\nrequire example.com/dep v1.0.0\nreplace example.com/dep => ../local\n');
	expect((await lookup(dir, 'a.go')).matches).toEqual([]);
});

test('source, read and output caps remain enforced for huge declarations and hostile JSON characters', async () => {
	const dir = await fixture({
		'a.ts': source,
		'node_modules/@aws-sdk/client-s3/package.json': JSON.stringify({
			name: '@aws-sdk/client-s3',
			version: '3.750.0',
			types: 'index.d.ts'
		}),
		'node_modules/@aws-sdk/client-s3/index.d.ts': 'getObject' + '\0😀'.repeat(100000)
	});

	const result = await lookup(dir);

	expect(result.matches[0].files[0].truncated).toBe(true);
	expect(Buffer.byteLength(result.matches[0].files[0].content)).toBeLessThanOrEqual(3000);
});

test.each(['../secret.ts', '/etc/passwd', 'a/../../secret.ts', 'a\\secret.ts', 'a\0.ts'])(
	'unsafe candidate path never reads source: %j',
	async (file) => {
		const dir = await fixture({ 'a.ts': source });

		expect((await lookup(dir, file)).matches).toEqual([]);
	}
);

test.each(['../secret.ts', '/etc/passwd', 'link.d.ts'])(
	'declaration paths cannot escape a package: %s',
	async (types) => {
		const dir = await fixture({
			'a.ts': source,
			'node_modules/@aws-sdk/client-s3/package.json': JSON.stringify({
				name: '@aws-sdk/client-s3',
				version: '3.750.0',
				types
			}),
			'node_modules/@aws-sdk/secret.ts': 'getObject SECRET',
			'secret.ts': 'getObject SECRET'
		});

		await symlink(join(dir, 'secret.ts'), join(dir, 'node_modules/@aws-sdk/client-s3/link.d.ts'));

		const result = await lookup(dir);

		expect(result.matches).toEqual([]);
		expect(JSON.stringify(result)).not.toContain('SECRET');
	}
);

test('package symlinks cannot redirect lookup outside the installation tree', async () => {
	const dir = await fixture({
		'a.ts': source,
		'secret/package.json': pkg,
		'secret/types/index.d.ts': 'getObject SECRET'
	});

	await mkdir(join(dir, 'node_modules/@aws-sdk'), { recursive: true });
	await symlink(join(dir, 'secret'), join(dir, 'node_modules/@aws-sdk/client-s3'));
	expect((await lookup(dir)).matches).toEqual([]);
	expect(await readFile(join(dir, 'secret/types/index.d.ts'), 'utf8')).toBe('getObject SECRET');
});
