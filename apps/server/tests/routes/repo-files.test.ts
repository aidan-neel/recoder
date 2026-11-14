import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_FILE_TEXT_BYTES, type RepoFile, type RepoTree } from '@recoder/shared';
import { reviewCheckoutPath } from '../../src/review/session/review-checkout';
import { db } from '../../src/store';
import { commitAll, git } from '../helpers/git';
import { testReview } from '../helpers/review';
import { send } from './reviews/finding-requests';

const dirs: string[] = [];
const trackedRepos = new Set<string>();
const trackedReviews = new Set<string>();

afterEach(async () => {
	for (const id of trackedReviews) await db.reviews.delete(id);
	for (const id of trackedRepos) await db.repos.delete(id);

	trackedReviews.clear();
	trackedRepos.clear();

	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A `local` repo on branch `main` holding `files` (with `links` symlinks) in one commit; answers its path. */
async function makeRepo(
	files: Record<string, string | Uint8Array>,
	links: Record<string, string> = {}
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'recoder-files-'));

	dirs.push(root);
	git(root, ['init', '-q', '-b', 'main']);

	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	}

	for (const [path, target] of Object.entries(links)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await symlink(target, join(root, path));
	}

	commitAll(root, 'files');

	return root;
}

/** Track `root` as a local repository; answers its id. */
async function trackLocalRepo(root: string): Promise<string> {
	const now = new Date().toISOString();
	const id = crypto.randomUUID();

	trackedRepos.add(id);

	await db.repos.set({
		id,
		name: 'fixture',
		url: pathToFileURL(root).href,
		provider: 'local',
		defaultBranch: 'main',
		createdAt: now,
		updatedAt: now
	});

	return id;
}

const tree = (id: string, query = '') => send(`/api/repos/${id}/tree${query}`, 'GET');
const file = (id: string, query: string) => send(`/api/repos/${id}/file${query}`, 'GET');

test('a directory lists its entries, directories first then by name', async () => {
	const root = await makeRepo({
		'zebra.md': 'z\n',
		'alpha.txt': 'a\n',
		'src/index.ts': 'i\n',
		'src/deep/nested.ts': 'n\n'
	});

	const id = await trackLocalRepo(root);

	const atRoot = (await (await tree(id)).json()) as RepoTree;

	expect(atRoot.path).toBe('');
	expect(atRoot.ref).toBe('main');
	expect(atRoot.commit).toMatch(/^[0-9a-f]{40}$/);

	expect(atRoot.entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
		'dir:src',
		'file:alpha.txt',
		'file:zebra.md'
	]);

	expect(atRoot.entries[1].size).toBe(2);

	const atSrc = (await (await tree(id, '?path=src')).json()) as RepoTree;

	expect(atSrc.path).toBe('src');
	expect(atSrc.entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual(['dir:deep', 'file:index.ts']);
	expect(atSrc.entries[0].path).toBe('src/deep');
});

test('a file answers its text, language, size and blob sha', async () => {
	const root = await makeRepo({ 'src/app.ts': 'export const A = 1;\n', LICENSE: 'do anything\n' });
	const id = await trackLocalRepo(root);

	const body = (await (await file(id, '?path=src/app.ts')).json()) as RepoFile;

	expect(body).toMatchObject({
		path: 'src/app.ts',
		ref: 'main',
		language: 'typescript',
		binary: false,
		truncated: false,
		size: 20,
		text: 'export const A = 1;\n'
	});

	expect(body.sha).toMatch(/^[0-9a-f]{40}$/);

	const license = (await (await file(id, '?path=LICENSE')).json()) as RepoFile;

	expect(license.language).toBeNull();
});

test('a file reads the commit ref names, so a review head sees the reviewed code', async () => {
	const root = await makeRepo({ 'a.ts': 'export const V = 1;\n' });
	const id = await trackLocalRepo(root);
	const first = git(root, ['rev-parse', 'HEAD']);

	await writeFile(join(root, 'a.ts'), 'export const V = 2;\n');
	commitAll(root, 'v2');

	const atFirst = (await (await file(id, `?path=a.ts&ref=${first}`)).json()) as RepoFile;
	const atBranch = (await (await file(id, '?path=a.ts&ref=main')).json()) as RepoFile;

	expect(atFirst.text).toBe('export const V = 1;\n');
	expect(atFirst.ref).toBe(first);
	expect(atFirst.commit).toBe(first);
	expect(atBranch.text).toBe('export const V = 2;\n');
});

test('a binary file answers no text but its real size', async () => {
	const root = await makeRepo({ 'assets/logo.bin': new Uint8Array([0, 1, 2, 3, 4]) });
	const id = await trackLocalRepo(root);

	const body = (await (await file(id, '?path=assets/logo.bin')).json()) as RepoFile;

	expect(body.binary).toBe(true);
	expect(body.size).toBe(5);
	expect(body.truncated).toBe(false);
	expect('text' in body).toBe(false);
});

test('a long file is cut at the cap and marked truncated', async () => {
	const text = `${'x'.repeat(REPO_FILE_TEXT_BYTES + 100)}\n`;
	const root = await makeRepo({ 'big.txt': text });
	const id = await trackLocalRepo(root);

	const body = (await (await file(id, '?path=big.txt')).json()) as RepoFile;

	expect(body.truncated).toBe(true);
	expect(body.size).toBe(text.length);
	expect(body.text?.length).toBe(REPO_FILE_TEXT_BYTES);
});

test('a symlink is listed with its target and is never followed', async () => {
	const root = await makeRepo({ 'real.ts': 'export {};\n' }, { 'link.ts': 'real.ts', evil: '/etc/passwd' });
	const id = await trackLocalRepo(root);

	const listing = (await (await tree(id)).json()) as RepoTree;
	const byName = new Map(listing.entries.map((entry) => [entry.name, entry]));

	expect(byName.get('link.ts')).toMatchObject({ kind: 'symlink', target: 'real.ts' });
	expect(byName.get('evil')).toMatchObject({ kind: 'symlink', target: '/etc/passwd' });

	for (const path of ['link.ts', 'evil']) {
		const res = await file(id, `?path=${path}`);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: `'${path}' is a symbolic link and is not followed.` });
	}
});

test('a submodule lists as a submodule and is refused as a file', async () => {
	const sub = await makeRepo({ 'inside.ts': 'export {};\n' });
	const root = await makeRepo({ 'a.ts': 'export {};\n' });

	git(root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', sub, 'sub']);
	commitAll(root, 'add sub');

	const id = await trackLocalRepo(root);

	const listing = (await (await tree(id)).json()) as RepoTree;

	expect(listing.entries.find((entry) => entry.name === 'sub')).toMatchObject({ kind: 'submodule', path: 'sub' });
	expect((await file(id, '?path=sub')).status).toBe(400);
});

test('directories, missing paths and files under the wrong kind each get their status', async () => {
	const root = await makeRepo({ 'src/a.ts': 'export {};\n' });
	const id = await trackLocalRepo(root);

	expect((await file(id, '?path=src')).status).toBe(400);
	expect((await tree(id, '?path=src/a.ts')).status).toBe(400);
	expect((await file(id, '?path=src/missing.ts')).status).toBe(404);
	expect((await tree(id, '?path=missing')).status).toBe(404);
});

test('absolute, traversal, NUL and dot paths are refused before git runs', async () => {
	const root = await makeRepo({ 'a.ts': 'export {};\n' });
	const id = await trackLocalRepo(root);

	for (const path of ['../secret', '/etc/passwd', 'a/../b', './a', 'a//b', 'a\0b']) {
		for (const route of ['file', 'tree']) {
			const res = await send(`/api/repos/${id}/${route}?path=${encodeURIComponent(path)}`, 'GET');

			expect(res.status, `${route} ${JSON.stringify(path)}`).toBe(400);
		}
	}
});

test('a ref must look like a commit-ish, and one git cannot resolve is a 404', async () => {
	const root = await makeRepo({ 'a.ts': 'export {};\n' });
	const id = await trackLocalRepo(root);

	for (const ref of ['-x', 'a..b', 'a;b', 'main~2', 'ref name', 'main:src']) {
		expect((await file(id, `?path=a.ts&ref=${encodeURIComponent(ref)}`)).status, ref).toBe(400);
	}

	expect((await file(id, '?path=a.ts&ref=no-such-branch')).status).toBe(404);
	expect((await file(id, `?path=a.ts&ref=${'0'.repeat(40)}`)).status).toBe(404);
});

test('a ref a review checkout alone holds still resolves', async () => {
	const root = await makeRepo({ 'a.ts': 'export {};\n' });
	const id = await trackLocalRepo(root);
	const repo = (await db.repos.get(id))!;
	const review = testReview({ repoId: id, prNumber: 1 });
	const checkout = reviewCheckoutPath(review, repo);

	dirs.push(checkout);
	await mkdir(dirname(checkout), { recursive: true });
	git(root, ['clone', '-q', root, checkout]);
	await writeFile(join(checkout, 'added.ts'), 'export const ADDED = 1;\n');
	commitAll(checkout, 'pr head');

	const head = git(checkout, ['rev-parse', 'HEAD']);

	trackedReviews.add(review.id);
	await db.reviews.set({ ...review, headSha: head });

	const body = (await (await file(id, `?path=added.ts&ref=${head}`)).json()) as RepoFile;

	expect(body.text).toBe('export const ADDED = 1;\n');
	expect(body.commit).toBe(head);
});

test('an untracked or malformed repository id is refused', async () => {
	expect((await send('/api/repos/bad~id/tree', 'GET')).status).toBe(400);
	expect((await send('/api/repos/missing/tree', 'GET')).status).toBe(404);
	expect((await send('/api/repos/missing/file?path=a.ts', 'GET')).status).toBe(404);
});

test('a hosted repository no review has copied is cloned on its first read', async () => {
	const origin = await makeRepo({ 'README.md': '# Shop\n' });
	const id = await trackHostedRepo(pathToFileURL(origin).href);

	const res = await file(id, '?path=README.md');

	expect(res.status).toBe(200);
	expect(((await res.json()) as RepoFile).text).toBe('# Shop\n');
});

test('a hosted repository git cannot copy answers why instead of a missing file', async () => {
	const gone = join(tmpdir(), `recoder-files-gone-${crypto.randomUUID()}`);
	const id = await trackHostedRepo(pathToFileURL(gone).href);

	const res = await file(id, '?path=README.md');

	expect(res.status).toBe(502);

	expect(await res.json()).toMatchObject({
		error: 'Could not copy the repository to this server; check its connection.'
	});
});

/** Track a GitLab repository that clones from `url`, so a clone runs without the network; answers its id. */
async function trackHostedRepo(url: string): Promise<string> {
	const now = new Date().toISOString();
	const id = crypto.randomUUID();

	trackedRepos.add(id);

	await db.repos.set({
		id,
		name: 'acme/shop',
		url,
		provider: 'gitlab',
		defaultBranch: 'main',
		createdAt: now,
		updatedAt: now
	});

	return id;
}
