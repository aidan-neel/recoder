import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { commitAll, git } from '../helpers/git';

/** A minimal monorepo shaped like this one: a server package, two web apps, shared and a UI kit. */
const WORKSPACE_FILES: Record<string, string> = {
	'package.json': JSON.stringify({ name: 'recoder', private: true, workspaces: ['apps/*', 'packages/*'] }),
	'bun.lock': '',
	'apps/server/package.json': JSON.stringify({
		name: '@recoder/server',
		dependencies: { '@recoder/shared': 'workspace:*' }
	}),
	'apps/server/src/index.ts': 'export {};\n',
	'apps/app/package.json': JSON.stringify({
		name: '@recoder/app',
		dependencies: { '@recoder/ui': 'workspace:*', '@recoder/shared': 'workspace:*' }
	}),
	'apps/app/page.tsx': 'export default function Page() {}\n',
	'apps/web/package.json': JSON.stringify({ name: '@recoder/web', dependencies: { '@recoder/shared': 'workspace:*' } }),
	'apps/web/src/app.ts': 'export {};\n',
	'packages/shared/package.json': JSON.stringify({ name: '@recoder/shared' }),
	'packages/shared/index.ts': 'export {};\n',
	'packages/ui/package.json': JSON.stringify({ name: '@recoder/ui' }),
	'packages/ui/index.ts': 'export {};\n'
};

/** Writes the fixture monorepo into `root`. */
export async function writeWorkspaceTree(root: string): Promise<void> {
	for (const [path, text] of Object.entries(WORKSPACE_FILES)) {
		const file = join(root, path);

		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, text);
	}
}

export interface Checkout {
	/** The repo the checkout's `origin` points at; commits here become the update. */
	source: string;
	/** The clone the update runs against. */
	root: string;
}

/** A source repo cloned to a checkout, so `git fetch` works offline. */
export async function makeCheckout(): Promise<Checkout> {
	const source = await mkdtemp(join(tmpdir(), 'recoder-update-source-'));

	git(source, ['init', '-q', '-b', 'main']);
	await writeWorkspaceTree(source);
	commitAll(source, 'base');

	const parent = await mkdtemp(join(tmpdir(), 'recoder-update-checkout-'));
	const root = join(parent, 'checkout');

	git(parent, ['clone', '-q', source, root]);

	return { source, root };
}

/** Commits `files` to the source repo, so the checkout's next fetch sees them. */
export async function upstreamCommit(
	source: string,
	files: Record<string, string>,
	subject = 'upstream change'
): Promise<void> {
	for (const [path, text] of Object.entries(files)) {
		const file = join(source, path);

		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, text);
	}

	commitAll(source, subject);
}
