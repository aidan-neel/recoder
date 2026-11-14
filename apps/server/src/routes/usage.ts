import { Hono } from 'hono';
import { DEFAULT_USAGE_DAYS, USAGE_DAYS } from '@recoder/shared';
import { loadUsageReport } from '../usage/usage-load';

/** The usage dashboard's data. Admin-only: `isAdminOnly` refuses a member before this route runs. */
const app = new Hono();

app.get('/', async (c) => {
	const asked = c.req.query('days');
	const days = asked === undefined ? DEFAULT_USAGE_DAYS : USAGE_DAYS.find((window) => String(window) === asked);

	if (days === undefined) return c.json({ error: `Pass days as one of ${USAGE_DAYS.join(', ')}.` }, 400);

	return c.json(await loadUsageReport(days));
});

export default app;
