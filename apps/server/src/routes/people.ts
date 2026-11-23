import { Hono } from 'hono';
import { accounts } from '../accounts/account-records';
import { findAdmin } from '../accounts/account-store';
import { currentAccount, hasBearerAccess } from '../accounts/enforcement';
import { ForgeHostError, isKnownHost, resolveForgeTarget } from '../accounts/forge-host';
import { knownForgeHosts } from '../accounts/members';
import { db } from '../store';
import { loadPersonProfile, profileRepositories } from '../people/profile';
import { profileLogin } from '../people/profile-forge';
import { messageableAccount, personSummary } from '../people/summary';

const app = new Hono<{ Variables: { peopleAccount: string } }>();

app.use('*', async (c, next) => {
	const account = (await currentAccount(c)) ?? (hasBearerAccess(c) ? await findAdmin() : undefined);

	if (!account) return c.json({ error: 'Sign in to continue.', kind: 'signed-out' }, 401);

	c.set('peopleAccount', account.id);

	return next();
});

app.get('/', async (c) =>
	c.json(
		(await accounts.list())
			.filter((account) => account.id !== c.var.peopleAccount && messageableAccount(account))
			.map(personSummary)
			.sort((a, b) => a.login.localeCompare(b.login))
	)
);

app.get('/:provider/:login', async (c) => {
	const { provider, login } = c.req.param();

	if ((provider !== 'github' && provider !== 'gitlab') || !profileLogin.test(login))
		return c.json({ error: 'Person not found.' }, 404);

	try {
		const ref = { ...resolveForgeTarget({ provider, host: c.req.query('host') }), login };
		const repos = await db.repos.list();

		if (
			ref.provider === 'gitlab' &&
			ref.host !== null &&
			profileRepositories(ref, repos).length === 0 &&
			!isKnownHost(ref, await knownForgeHosts())
		) {
			return c.json({ error: 'Person not found.' }, 404);
		}

		const profile = await loadPersonProfile(ref, c.var.peopleAccount, repos);

		return profile ? c.json(profile) : c.json({ error: 'Person not found.' }, 404);
	} catch (error) {
		if (error instanceof ForgeHostError) return c.json({ error: 'Person not found.' }, 404);
		throw error;
	}
});

export default app;
