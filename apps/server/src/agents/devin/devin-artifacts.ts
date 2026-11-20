import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Opt-in private raw exports for diagnosing interrupted CLI sessions; disabled outside explicit diagnostic runs. */
export async function retainDevinExport(source: string, env: Record<string, string | undefined>): Promise<void> {
	const directory = env.RECODER_DEVIN_EXPORT_DIR;

	if (!directory) return;
	await mkdir(directory, { recursive: true, mode: 0o700 });

	const target = join(directory, `${Date.now()}-${crypto.randomUUID()}.json`);

	try {
		await copyFile(source, target);
		await chmod(target, 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}
