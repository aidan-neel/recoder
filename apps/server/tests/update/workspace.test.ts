import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyPaths, readWorkspaceGraph } from '../../src/update/workspace';
import { writeWorkspaceTree } from './fixture';

async function graph(): Promise<Awaited<ReturnType<typeof readWorkspaceGraph>>> {
	const root = await mkdtemp(join(tmpdir(), 'recoder-update-workspace-'));

	await writeWorkspaceTree(root);

	return readWorkspaceGraph(root);
}

describe('readWorkspaceGraph', () => {
	test('reads the packages and the server’s transitive dependencies from the package.json files', async () => {
		const { packages, serverDirs, webDirs } = await graph();

		expect(packages.get('apps/server')).toBe('@recoder/server');
		expect(packages.get('packages/shared')).toBe('@recoder/shared');
		expect(serverDirs).toEqual(new Set(['apps/server', 'packages/shared']));
		expect(webDirs).toContain('apps/app');
		expect(webDirs).toContain('apps/web');
		expect(webDirs).toContain('packages/ui');
		expect(webDirs).not.toContain('apps/server');
	});
});

describe('classifyPaths', () => {
	test('marks server-owned paths server-side and other packages web-side', async () => {
		const workspace = await graph();

		expect(classifyPaths(['apps/server/src/review/harness.ts'], workspace)).toEqual({
			server: true,
			web: false,
			install: false
		});

		expect(classifyPaths(['apps/app/components/pull.tsx', 'packages/ui/src/button.ts'], workspace)).toEqual({
			server: false,
			web: true,
			install: false
		});
	});

	test('counts a shared package on both sides, since the web app imports it too', async () => {
		const workspace = await graph();

		expect(classifyPaths(['packages/shared/src/review.ts'], workspace)).toEqual({
			server: true,
			web: true,
			install: false
		});
	});

	test('owes bun install for the root lockfile and for any package.json, and the root ones touch both sides', async () => {
		const workspace = await graph();

		expect(classifyPaths(['bun.lock'], workspace)).toEqual({ server: true, web: true, install: true });
		expect(classifyPaths(['package.json'], workspace)).toEqual({ server: true, web: true, install: true });
		expect(classifyPaths(['apps/app/package.json'], workspace)).toEqual({ server: false, web: true, install: true });
	});

	test('leaves paths nothing owns — docs, charts, CI — asking for neither side nor install', async () => {
		const workspace = await graph();

		expect(classifyPaths(['docs/review/cli.md', 'charts/recoder/values.yaml'], workspace)).toEqual({
			server: false,
			web: false,
			install: false
		});
	});
});
