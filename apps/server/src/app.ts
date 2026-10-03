import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './env';
import auth from './routes/auth';
import health from './routes/health';
import guidelines from './routes/guidelines';
import home from './routes/home';
import agent from './routes/agent';
import settings from './routes/settings';
import repos from './routes/repos';
import reviews from './routes/reviews';
import runs from './routes/runs';
import webhooks from './routes/webhooks';
import { VERSION } from './version';
import { ModelConfigError } from './models/models';

/** CORS for the web app, which revalidates the review diff by ETag. */
const corsOptions = {
	origin: '*',
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256', 'If-None-Match'],
	exposeHeaders: ['ETag']
};

/** Any route that needs a model says what to set up instead of a bare 500. */
function handleError(err: Error, c: Context): Response {
	if (err instanceof ModelConfigError) return c.json({ error: err.message, action: 'settings' }, 409);
	console.error('[recoder] unhandled error', err);

	return c.json({ error: 'internal server error' }, 500);
}

export const app = new Hono();

app.use('*', logger());

app.use('*', cors(corsOptions));

app.get('/', (c) => c.json({ name: 'recoder', version: VERSION, frontend: env.FRONTEND_URL, health: '/health' }));
app.route('/health', health);
app.route('/api/auth', auth);
app.route('/api/home', home);
app.route('/api/guidelines', guidelines);
app.route('/api/settings', settings);
app.route('/api/agent', agent);
app.route('/api/repos', repos);
app.route('/api/reviews', reviews);
app.route('/api/runs', runs);
app.route('/api/webhooks', webhooks);

app.notFound((c) => c.json({ error: 'not found' }, 404));

app.onError(handleError);
