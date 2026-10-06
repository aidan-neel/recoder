import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildChangeModel } from '../../../../src/review/pipeline/change-model/change-model';
import type { ChangeModel } from '../../../../src/review/pipeline/change-model/types';
import { buildInventory, type ReviewInventory } from '../../../../src/review/pipeline/inventory';

/** A built change model and the inventory it came from. */
export interface Built {
	model: ChangeModel;
	inventory: ReviewInventory;
}

function git(cwd: string, args: string[]): string {
	const out = Bun.spawnSync(
		['git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
		{
			cwd
		}
	);

	if (out.exitCode !== 0) throw new Error(out.stderr.toString());

	return out.stdout.toString();
}

async function writeAll(root: string, files: Record<string, string>): Promise<void> {
	for (const [path, content] of Object.entries(files)) {
		const full = join(root, path);

		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, content);
	}
}

/**
 * Commits `base`, then `head` on top in a throwaway git
 * repo, and builds the change model of the diff between them. Caller
 * selection follows `callerSelection`, or the environment when it is unset.
 */
export async function buildFrom(
	base: Record<string, string>,
	head: Record<string, string>,
	callerSelection?: boolean
): Promise<Built> {
	const root = await mkdtemp(join(tmpdir(), 'change-model-'));

	try {
		git(root, ['init', '-q']);
		await writeAll(root, base);
		git(root, ['add', '-A']);
		git(root, ['commit', '-q', '--allow-empty', '-m', 'base']);

		const baseSha = git(root, ['rev-parse', 'HEAD']).trim();

		await writeAll(root, head);
		git(root, ['add', '-A']);
		git(root, ['commit', '-q', '-m', 'head']);

		const inventory = buildInventory(git(root, ['diff', baseSha, 'HEAD']), []);

		const model = await buildChangeModel({
			inventory,
			checkoutPath: root,
			signal: new AbortController().signal,
			baseSha,
			callerSelection
		});

		return { model, inventory };
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
