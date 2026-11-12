import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { removeScratchDir, scratchDir } from '../cli-process';

/** The files of one call or run, under a scratch dir of its own: the system prompt, and the session Pi saves. */
export interface PiScratch {
	root: string;
	system: string;
	session: string;
}

/**
 * Makes a scratch dir holding the system prompt (owner-only, like the dir), and adds it to `owned`, the set the
 * adapter's `stop` deletes at exit. Pi saves the session under it, so deleting the dir deletes the session.
 */
export async function makeScratch(owned: Set<string>, prefix: string, system: string): Promise<PiScratch> {
	const root = await scratchDir(owned, prefix);
	const files = { root, system: join(root, 'system.md'), session: join(root, 'sessions', 'session.jsonl') };

	try {
		await writeFile(files.system, system, { mode: 0o600 });
	} catch (error) {
		await removeScratchDir(owned, root);
		throw error;
	}

	return files;
}
