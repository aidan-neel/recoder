import { readFile } from 'node:fs/promises';
import { postgres } from '../../storage/backend';
import type { UpdaterSocket } from './protocol';

const PATH = '/run/recoder-updater/control.sock';
const TOKEN_FILE = '/run/secrets/recoder-updater-token';

export async function configuredUpdater(): Promise<UpdaterSocket | undefined> {
	if (postgres || process.env.KUBERNETES_SERVICE_HOST) return;

	try {
		return { path: PATH, token: (await readFile(TOKEN_FILE, 'utf8')).trim() };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}
