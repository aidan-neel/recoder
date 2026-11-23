import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { findAccountById } from '../accounts/account-store';
import { currentAccount } from '../accounts/enforcement';
import { requestSessionToken } from '../accounts/session-cookie';
import { sessionStillActive } from '../accounts/sessions';
import { serverLog } from '../deploy/logs/stream';
import { streamInbox } from '../messages/inbox-stream';
import { MessageError, MessageStore, parseSequence } from '../messages/store';
import { postgres } from '../storage/backend';
import { sqlite } from '../storage/sqlite';
import { isTrustedOrigin } from './trusted-origin';

const app = new Hono<{ Variables: { messageAccount: string } }>();
const messages = new MessageStore(postgres ? { kind: 'postgres', sql: postgres } : { kind: 'sqlite', open: sqlite });

app.use('*', async (c, next) => {
	const account = await currentAccount(c);

	if (!account) return c.json({ error: 'Messages require a signed-in session.' }, 403);

	const origin = c.req.header('origin');

	if (c.req.method === 'POST' && origin && !isTrustedOrigin(origin, c.req.url))
		return c.json({ error: 'Untrusted origin' }, 403);

	c.header('Cache-Control', 'no-store, no-transform');
	c.set('messageAccount', account.id);

	return next();
});

app.get('/', async (c) => c.json(await messages.list(c.var.messageAccount)));

app.post('/', async (c) => c.json(await messages.start(c.var.messageAccount, await c.req.json().catch(() => null))));

app.get('/events', (c) => {
	if (c.req.method === 'HEAD') return c.body(null, 200, { 'Content-Type': 'text/event-stream' });

	const accountId = c.var.messageAccount;
	const token = requestSessionToken(c)!;
	const after = parseSequence(c.req.header('Last-Event-ID'));

	const response = streamSSE(c, async (stream) => {
		const signal = c.req.raw.signal;
		const abort = () => stream.abort();

		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();

		try {
			await streamInbox(
				stream,
				messages,
				accountId,
				after,
				async () => (await sessionStillActive(token, accountId)) && !!(await findAccountById(accountId))
			);
		} catch {
			serverLog('error', 'An inbox stream failed.');
		} finally {
			signal.removeEventListener('abort', abort);
		}
	});

	response.headers.set('Cache-Control', 'no-store, no-transform');
	response.headers.set('X-Accel-Buffering', 'no');

	return response;
});

app.get('/:id', async (c) =>
	c.json(await messages.page(c.var.messageAccount, c.req.param('id'), c.req.query('before')))
);

app.post('/:id', async (c) =>
	c.json(await messages.send(c.var.messageAccount, c.req.param('id'), await c.req.json().catch(() => null)))
);

app.post('/:id/read', async (c) =>
	c.json(await messages.markRead(c.var.messageAccount, c.req.param('id'), await c.req.json().catch(() => null)))
);

app.onError((error, c) => {
	if (error instanceof MessageError) return c.json({ error: error.message }, error.status);

	throw error;
});

export default app;
