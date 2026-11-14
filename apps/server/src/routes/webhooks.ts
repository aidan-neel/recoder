import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { env } from '../env';
import { handlePullHook, type HookOutcome, type PullHook } from '../forge/watch/webhook-event';
import { githubHook, gitlabHook } from '../forge/watch/webhook-payloads';
import { sameSecret } from '../util/same-secret';

function verifySignature(secret: string, signature: string | null | undefined, raw: string): boolean {
	if (!signature?.startsWith('sha256=')) return false;

	const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
	const a = Buffer.from(signature);
	const b = Buffer.from(expected);

	return a.length === b.length && timingSafeEqual(a, b);
}

function parseJson(raw: string):
	| {
			ok: true;
			value: unknown;
	  }
	| {
			ok: false;
	  } {
	try {
		return { ok: true, value: JSON.parse(raw) };
	} catch {
		return { ok: false };
	}
}

/** Hand a recognised event to the watcher's rules; anything else is acknowledged and ignored. */
async function answer(c: Context, hook: PullHook | null): Promise<Response> {
	const outcome: HookOutcome = hook ? await handlePullHook(hook) : { received: true, reviewCreated: false };

	return c.json(outcome, outcome.reviewCreated ? 201 : 200);
}

const app = new Hono();

/**
 * GitHub webhook at https://<host>/api/webhooks/github, content type
 * application/json, with the "Pull requests", "Issue comments" and "Pull
 * request review comments" events. Reviews follow the auto-review settings.
 */
app.post('/github', async (c) => {
	const raw = await c.req.text();

	if (
		env.GITHUB_WEBHOOK_SECRET &&
		!verifySignature(env.GITHUB_WEBHOOK_SECRET, c.req.header('x-hub-signature-256'), raw)
	) {
		return c.json({ error: 'invalid signature' }, 401);
	}

	const payload = parseJson(raw);

	if (!payload.ok) return c.json({ error: 'invalid json' }, 400);

	const event = c.req.header('x-github-event');

	if (event === 'ping') return c.json({ received: true, message: 'pong' });

	return await answer(c, githubHook(event, payload.value));
});

/**
 * GitLab webhook at https://<host>/api/webhooks/gitlab with "Merge request
 * events" and "Comments" ticked. When `GITLAB_WEBHOOK_SECRET` is set, the
 * hook's secret token must match it.
 */
app.post('/gitlab', async (c) => {
	if (env.GITLAB_WEBHOOK_SECRET && !sameSecret(env.GITLAB_WEBHOOK_SECRET, c.req.header('x-gitlab-token'))) {
		return c.json({ error: 'invalid token' }, 401);
	}

	const payload = parseJson(await c.req.text());

	if (!payload.ok) return c.json({ error: 'invalid json' }, 400);

	return await answer(c, gitlabHook(payload.value));
});

export default app;
