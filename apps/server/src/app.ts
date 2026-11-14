import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './env';
import { requireSession } from './accounts/enforcement';
import accounts from './routes/accounts';
import oauthRedirect from './routes/oauth-redirect';
import { isTrustedOrigin } from './routes/trusted-origin';
import { flushReviewEvents } from './review/session/events';
import auth from './routes/auth';
import chats from './routes/chats';
import health from './routes/health';
import guidelines from './routes/guidelines';
import members from './routes/members';
import meModels from './routes/me-models';
import usage from './routes/usage';
import home from './routes/home';
import agent from './routes/agent';
import settings from './routes/settings';
import vllm from './routes/vllm';
import autoReview from './routes/auto-review';
import pulls from './routes/pulls';
import pull from './routes/pulls/pull';
import learnedRules from './routes/learned-rules';
import repoFiles from './routes/repo-files';
import repos from './routes/repos';
import reviews from './routes/reviews';
import runs from './routes/runs';
import update from './routes/update';
import webhooks from './routes/webhooks';
import { VERSION } from './version';
import { ModelConfigError } from './models/models';
import { postgres, settingsOperation } from './storage/backend';
import { SharedSettingsConflictError } from './config/shared-settings';
import { redacted } from './util/redact';

/**
 * CORS for the web app, which revalidates the review diff by ETag. The app's own origin (`FRONTEND_URL`, or any
 * loopback origin in development) may send the session cookie; any other origin gets the open `*`, which browsers
 * will not combine with credentials, so a site that is not the app can read nothing that needs a session.
 */
const corsOptions = {
	origin: (origin: string, c: Context) => (isTrustedOrigin(origin, c.req.url) ? origin : '*'),
	credentials: true,
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256', 'X-Gitlab-Token', 'If-None-Match'],
	exposeHeaders: ['ETag']
};

/** Any route that needs a model says what to set up instead of a bare 500. */
function handleError(err: Error, c: Context): Response {
	if (err instanceof ModelConfigError) return c.json({ error: err.message, action: 'settings' }, 409);
	if (err instanceof SharedSettingsConflictError) return c.json({ error: err.message }, 409);
	if (postgres) console.error('[recoder] shared API operation failed', err.name);
	else console.error('[recoder] unhandled error', redacted(err.stack ?? err.message, []));

	return c.json({ error: 'internal server error' }, 500);
}

export const app = new Hono();

app.use('*', logger());

app.use('*', cors(corsOptions));
app.use('/api/*', requireSession);
app.use('/api/*', async (_c, next) => settingsOperation(next));

app.use('/api/reviews/:id/*', async (c, next) => {
	const id = c.req.param('id');

	await flushReviewEvents(id);
	await next();
	await flushReviewEvents(id);
});

app.get('/', (c) => c.json({ name: 'recoder', version: VERSION, frontend: env.FRONTEND_URL, health: '/health' }));
app.route('/health', health);
app.route('/api/auth', accounts);
app.route('/api/auth', oauthRedirect);
app.route('/api/auth', auth);
app.route('/api/members', members);
app.route('/api/me/models', meModels);
app.route('/api/usage', usage);
app.route('/api/home', home);
app.route('/api/guidelines', guidelines);
app.route('/api/settings/auto-review', autoReview);
app.route('/api/settings/vllm', vllm);
app.route('/api/settings', settings);
app.route('/api/agent', agent);
app.route('/api/pulls', pulls);
app.route('/api/repos', pull);
app.route('/api/repos', learnedRules);
app.route('/api/repos', repoFiles);
app.route('/api/repos', repos);
app.route('/api/chats', chats);
app.route('/api/reviews', reviews);
app.route('/api/runs', runs);
app.route('/api/update', update);
app.route('/api/webhooks', webhooks);

app.notFound((c) => c.json({ error: 'not found' }, 404));

app.onError(handleError);
