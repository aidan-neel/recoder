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

	let payload: any = null;
	try {
		payload = JSON.parse(raw);
	} catch {
		return c.json({ error: 'invalid json' }, 400);
	}

	const event = c.req.header('x-github-event');
	if (event === 'ping') return c.json({ received: true, message: 'pong' });

	if (event === 'pull_request' && ['opened', 'synchronize', 'reopened'].includes(payload?.action)) {
		const repoUrl: string | undefined =
			payload?.repository?.html_url ?? payload?.repository?.clone_url;
		const repo = db.repos.list().find((r) => r.url === repoUrl);
		if (!repo) {
			return c.json({ received: true, reviewCreated: false, reason: 'repo not tracked' });
		}
		const review = queueReview({
			repoId: repo.id,
			prNumber: payload.pull_request.number,
			headSha: payload.pull_request.head?.sha
		});
		return c.json({ received: true, reviewCreated: true, reviewId: review.id }, 201);
	}

	return c.json({ received: true, reviewCreated: false });
});

export default app;
