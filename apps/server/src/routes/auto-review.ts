import { Hono } from 'hono';
import type { AutoReviewPayload } from '@recoder/shared';
import { autoReviewPatchSchema, readAutoReviewSettings, saveAutoReviewSettings } from '../forge/watch/settings';
import { autoReviewStatus, checkNow, restartWatcher } from '../forge/watch/watcher';
import { settingsOperation } from '../storage/backend';

const WEBHOOK_PATHS: AutoReviewPayload['webhookPaths'] = {
	gitlab: '/api/webhooks/gitlab',
	github: '/api/webhooks/github'
};

async function payload(): Promise<AutoReviewPayload> {
	const settings = readAutoReviewSettings();

	return { settings, status: await autoReviewStatus(settings), webhookPaths: WEBHOOK_PATHS };
}

const app = new Hono();

app.get('/', async (c) => c.json(await payload()));

/** Save part of the settings and restart the watcher on them. */
app.put('/', async (c) => {
	const parsed = autoReviewPatchSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid settings' }, 400);

	saveAutoReviewSettings(parsed.data);
	restartWatcher();

	return c.json(await payload());
});

/** Run one round now and answer with what it found. */
app.post('/check', async (c) => {
	await checkNow();

	return c.json(await settingsOperation(payload));
});

export default app;
