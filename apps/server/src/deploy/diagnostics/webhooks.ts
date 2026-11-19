import type { ServerCheck } from '@recoder/shared';
import { env } from '../../env';
import { collection, storageNow } from '../../storage/backend';

const ID = 'deploy:last-webhook';
const deliveries = collection<{ id: string; receivedAt: number }>('update_state');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function recordWebhookDelivery(): Promise<void> {
	try {
		const receivedAt = await storageNow();

		await deliveries.update(ID, (previous) => ({
			id: ID,
			receivedAt: Math.max(previous?.receivedAt ?? 0, receivedAt)
		}));
	} catch {
		console.warn('[diagnostics] could not record webhook delivery time');
	}
}

export async function checkWebhooks(): Promise<ServerCheck> {
	const id = 'webhooks';
	const delivery = await deliveries.get(ID);

	if (delivery && (await storageNow()) - delivery.receivedAt <= WEEK_MS) {
		return { id, state: 'ok', detail: 'A webhook arrived in the last 7 days.' };
	}

	if (!delivery && !env.GITHUB_WEBHOOK_SECRET && !env.GITLAB_WEBHOOK_SECRET) {
		return { id, state: 'skipped', detail: 'No webhook is configured; polling only.' };
	}

	return {
		id,
		state: 'warn',
		detail: 'No webhook arrived in the last 7 days.',
		fix: 'Check the forge’s delivery log. Polling still works.'
	};
}
