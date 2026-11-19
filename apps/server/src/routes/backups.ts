import { Hono, type Context } from 'hono';
import { refuseWhileLocked } from '../accounts/setup-gate';
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

const app = new Hono();

app.use('*', async (c, next) => (await refuseWhileLocked(c)) ?? next());

async function controlled(c: Context, work: () => Response | Promise<Response>): Promise<Response> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof BackupRefusedError) return c.json({ error: error.message }, 409);
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

export default app;
