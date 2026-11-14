import { Hono, type Context } from 'hono';
import { listMembers, MemberError, removeMember } from '../accounts/members';
import { trustedOrigin } from './trusted-origin';

/** The admin's list of who has signed in. The admin-only check is `isAdminOnly`, applied before these routes run. */
const app = new Hono();

app.use('*', trustedOrigin);

/** The admin first, then the members in the order they joined. */
app.get('/', async (c) => c.json(await listMembers()));

/** Removes a member by the `key` the list gives. */
app.delete('/:key', async (c) => {
	try {
		await removeMember(c.req.param('key'));

		return c.body(null, 204);
	} catch (error) {
		return memberFailure(c, error);
	}
});

function memberFailure(c: Context, error: unknown): Response {
	if (error instanceof MemberError) return c.json({ error: error.message }, error.status);

	throw error;
}

export default app;
