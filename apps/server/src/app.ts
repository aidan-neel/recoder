import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { matchedRoutes } from 'hono/route';
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
import telemetry from './routes/telemetry';
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
import backups from './routes/backups';
import serverLogs from './routes/server-logs';
import { createServerInfoRoutes } from './routes/server-info';
import { createSetupAddressRoutes } from './routes/setup-address';
import { createSetupChecklistRoutes } from './routes/setup-checklist';
import { readAddressStatus } from './deploy/setup/address';
import { serverLog } from './deploy/logs/stream';
import { SAFE_METHODS } from './accounts/admin-routes';
import { containerOperationPreparing } from './update/container/server';
import webhooks from './routes/webhooks';
import { VERSION } from './version';
import { ModelConfigError } from './models/models';
import { RepoFilesError } from './repo-files/errors';
import { UnknownSkillError } from './skills/repo-skills';
import { postgres, settingsOperation } from './storage/backend';
import { SharedSettingsConflictError } from './config/shared-settings';
import { jsonCompression } from './util/json-compression';
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

/**
 * Any route that needs a model says what to set up instead of a bare 500; a skill the repository lacks and a
 * repository copy that cannot be read answer as what they are.
 */
function handleError(err: Error, c: Context): Response {
	if (err instanceof ModelConfigError) return c.json({ error: err.message, action: 'settings' }, 409);
	if (err instanceof SharedSettingsConflictError) return c.json({ error: err.message }, 409);
	if (err instanceof UnknownSkillError) return c.json({ error: err.message }, 400);
	if (err instanceof RepoFilesError) return c.json({ error: err.message }, err.status);
	serverLog('error', 'A server request failed.');
	if (postgres) console.error('[recoder] shared API operation failed', err.name);
	else console.error('[recoder] unhandled error', redacted(err.stack ?? err.message, []));

	return c.json({ error: 'internal server error' }, 500);
}

export const app = new Hono();

app.use('*', async (c, next) => {
	await next();

	const route =
		matchedRoutes(c)
			.filter((match) => match.method === c.req.method)
			.at(-1)?.path ?? 'unmatched route';

	serverLog(c.res.status >= 500 ? 'error' : 'info', `${c.req.method} ${route} ${c.res.status}`);
});

app.use('*', cors(corsOptions));
app.use('/api/*', jsonCompression());
app.use('/api/*', requireSession);

app.use('/api/*', async (c, next) => {
	if (containerOperationPreparing() && !SAFE_METHODS.has(c.req.method))
		return c.json({ error: 'Recoder is preparing an update or restore. Try again shortly.' }, 409);

	return next();
});

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
app.route('/api/telemetry', telemetry);
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
app.route('/api/server/backups', backups);
app.route('/api/server/logs', serverLogs);
app.route('/api/server', createServerInfoRoutes({ readAddress: readAddressStatus }));
app.route('/api/setup/address', createSetupAddressRoutes());
app.route('/api/setup', createSetupChecklistRoutes({ readAddress: readAddressStatus }));
app.route('/api/webhooks', webhooks);

app.notFound((c) => c.json({ error: 'not found' }, 404));

app.onError(handleError);
