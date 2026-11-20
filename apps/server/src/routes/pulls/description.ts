import { Hono } from 'hono';
import { requestAccountId } from '../../accounts/enforcement';
import { pullDescription } from '../../review/description/description';
import { trustedOrigin } from '../trusted-origin';
import { pullRoute } from './shared';

const app = new Hono();

app.on(
	['GET', 'POST'],
	'/:id/pulls/:pr/description',
	trustedOrigin,
	pullRoute(async (c, { repo, n }) => {
		const person = await requestAccountId(c);

		return c.json(await pullDescription(repo, n, c.req.method === 'POST', person));
	})
);

export default app;
