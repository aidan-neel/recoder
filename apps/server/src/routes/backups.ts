import { Hono, type Context } from 'hono';
import { currentAccount } from '../accounts/enforcement';
import { refuseWhileLocked } from '../accounts/setup-gate';
import { protectDeploymentMutation } from '../deploy/setup/access';
import { secretKey } from '../secrets/secret-key';
import {
	backupPolicySchema,
	BackupRefusedError,
	backupStatus,
	deleteBackup,
	saveBackupPolicy,
	startBackup
} from '../storage/backups/service';
import { downloadBackup, findBackup, isMissingFile } from '../storage/backups/store';
import { serverDataDir } from '../util/data-dir';
import { configuredUpdater } from '../update/container/connection';
import { updaterTerminal, UpdaterRefused } from '../update/container/protocol';
import { beginContainer, containerOperationPreparing, containerStatus } from '../update/container/server';

const app = new Hono();

app.use('*', async (c, next) => (await refuseWhileLocked(c)) ?? next());
app.use('*', protectDeploymentMutation);

async function controlled(c: Context, work: () => Response | Promise<Response>): Promise<Response> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof BackupRefusedError || error instanceof UpdaterRefused)
			return c.json({ error: error.message }, 409);
		if (isMissingFile(error)) return c.json({ error: 'Backup not found.' }, 404);
		throw error;
	}
}

app.get('/', async (c) => c.json(await backupStatus()));

app.post('/', (c) =>
	controlled(c, async () => {
		void startBackup('manual').catch(() => {});

		return c.json({ ...(await backupStatus()), running: true }, 202);
	})
);

app.put('/policy', (c) =>
	controlled(c, async () => {
		const policy = backupPolicySchema.safeParse(await c.req.json().catch(() => null));

		if (!policy.success) return c.json({ error: 'Choose a valid backup hour and retention count.' }, 400);

		return c.json(await saveBackupPolicy(policy.data));
	})
);

app.delete('/:id', (c) =>
	controlled(c, async () => {
		const socket = await configuredUpdater();

		if (containerOperationPreparing() || (socket && !updaterTerminal((await containerStatus(socket)).state)))
			return c.json({ error: 'Backups are held while an update or restore is running.' }, 409);

		const state = await deleteBackup(c.req.param('id'));

		return state ? c.json(state) : c.json({ error: 'Backup not found.' }, 404);
	})
);

app.get('/:id/download', (c) =>
	controlled(c, async () => {
		const { supported, note } = await backupStatus();

		if (!supported) return c.json({ error: note }, 409);

		const id = c.req.param('id');
		const directory = await findBackup(serverDataDir(), id);

		if (!directory) return c.json({ error: 'Backup not found.' }, 404);

		return c.body(await downloadBackup(directory, c.req.query('key') === '1' ? secretKey().key : undefined), 200, {
			'Cache-Control': 'private, no-store',
			'Content-Disposition': `attachment; filename="recoder-${id}.tar.zst"`,
			'Content-Type': 'application/zstd',
			'X-Content-Type-Options': 'nosniff'
		});
	})
);

app.post('/:id/restore', (c) =>
	controlled(c, async () => {
		const socket = await configuredUpdater();

		if (!socket)
			return c.json(
				{ error: 'This deployment cannot restore while it is running. Use the offline operator command.' },
				409
			);

		const backup = c.req.param('id');

		if (!(await findBackup(serverDataDir(), backup))) return c.json({ error: 'Backup not found.' }, 404);

		return c.json(
			await beginContainer(socket, { action: 'restore', backup }, (await currentAccount(c))?.name ?? null),
			202
		);
	})
);

export default app;
