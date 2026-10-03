import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Writes `script` as an executable `name` in a temp dir and returns options whose PATH finds it first.
 * The PATH is passed explicitly because Bun ignores process.env PATH mutation.
 */
export async function fakeBin(name: string, script: string): Promise<{ env: Record<string, string> }> {
	const dir = await mkdtemp(join(tmpdir(), 'fakebin-'));

	await writeFile(join(dir, name), script);
	await chmod(join(dir, name), 0o755);

	return { env: { PATH: `${dir}:${process.env.PATH ?? ''}` } };
}
