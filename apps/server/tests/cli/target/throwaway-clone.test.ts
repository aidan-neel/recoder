import { afterAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveTarget } from '../../../src/cli/target/resolve-target';
import { git } from '../../helpers/git';
import { commitAll, fixtureFolder, removeFixtureFolders, targetRequest, userRepository, writeFiles } from './fixture';

afterAll(removeFixtureFolders);

test('a checkout of a repository that borrows objects reads its head, base and merge base on its own', async () => {
	const upstream = await userRepository();
	const dir = join(await fixtureFolder('recoder-borrower-'), 'borrower');

	git(upstream, ['clone', '--quiet', '--shared', upstream, dir]);
	git(dir, ['checkout', '-b', 'feature']);
	await writeFiles(dir, { 'a.ts': 'one\ntwo\n' });
	commitAll(dir, 'Change a');

	const resolved = await resolveTarget(targetRequest(dir, { kind: 'range', base: null, head: 'feature' }));
	const checkout = resolved.sandboxPath ?? '';

	await rm(upstream, { recursive: true, force: true });

	expect(resolved.report.base).toBe('origin/main');
	expect(existsSync(join(checkout, '.git', 'objects', 'info', 'alternates'))).toBe(false);

	for (const sha of [resolved.report.headSha, resolved.report.baseSha, resolved.report.mergeBaseSha]) {
		expect(() => git(checkout, ['archive', '--format=tar', sha ?? ''])).not.toThrow();
	}

	await resolved.dispose();
});
