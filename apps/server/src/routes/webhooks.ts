import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { queueReview } from '../commands/pipeline';
import { env } from '../env';
import { db } from '../store';

function verifySignature(secret: string, signature: string | null | undefined, raw: string): boolean {
	if (!signature?.startsWith('sha256=')) return false;

	const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
	const a = Buffer.from(signature);
	const b = Buffer.from(expected);

	return a.length === b.length && timingSafeEqual(a, b);
}

const app = new Hono();

/**
 * GitHub `pull_request` webhook. Configure the webhook URL as
 * https://<host>/api/webhooks/github with content type application/json.
 * Queues a review when the PR's repo is tracked; otherwise just acknowledges.
 */
app.post('/github', async (c) => {
	const raw = await c.req.text();

	if (env.GITHUB_WEBHOOK_SECRET) {
		const ok = verifySignature(env.GITHUB_WEBHOOK_SECRET, c.req.header('x-hub-signature-256'), raw);

		if (!ok) return c.json({ error: 'invalid signature' }, 401);
	}

	let payload: unknown;

	try {
		payload = JSON.parse(raw);
	} catch {
		return c.json({ error: 'invalid json' }, 400);
	}

	const event = c.req.header('x-github-event');

	if (event === 'ping') return c.json({ received: true, message: 'pong' });

	if (event === 'pull_request' && typeof payload === 'object' && payload !== null) {
		const p = payload as Record<string, unknown>;

		if (
			typeof p.action === 'string' &&
			['opened', 'synchronize', 'reopened'].includes(p.action) &&
			typeof p.repository === 'object' &&
			p.repository !== null
		) {
			const repo = p.repository as Record<string, unknown>;

			const repoUrl = (typeof repo.html_url === 'string' ? repo.html_url : null) ??
				(typeof repo.clone_url === 'string' ? repo.clone_url : null);

			if (repoUrl && typeof repoUrl === 'string') {
				const tracked = db.repos.list().find((r) => r.url === repoUrl);

				if (!tracked) {
					return c.json({ received: true, reviewCreated: false, reason: 'repo not tracked' });
				}

				try {
					const pr = p.pull_request as Record<string, unknown>;

					if (typeof pr.number !== 'number') throw new Error('No PR number in webhook');

					const review = queueReview({
						repoId: tracked.id,
						prNumber: pr.number,
						headSha: typeof (pr.head as Record<string, unknown>)?.sha === 'string'
							? ((pr.head as Record<string, unknown>).sha as string)
							: undefined
					});

					return c.json({ received: true, reviewCreated: true, reviewId: review.id }, 201);
				} catch (err) {
					return c.json({
						received: true,
						reviewCreated: false,
						reason: err instanceof Error ? err.message : 'could not queue review'
					});
				}
			}
		}
	}

	return c.json({ received: true, reviewCreated: false });
});

export default app;
