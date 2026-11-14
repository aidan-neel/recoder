import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { parseProviderKey, type AgentOAuthStatus } from '@recoder/shared';
import { providerLimits } from '../agents/limits';
import { OpenCodeError, opencode } from '../agents/opencode/opencode';
import { agentById, agentStatuses, forgetAgentModels } from '../agents/registry';
import {
	cancelSetupJob,
	getSetupJob,
	SetupJobError,
	setupJobInput,
	startSetupJob,
	type SetupStep
} from '../agents/setup/setup-jobs';
import { trustedOrigin } from './trusted-origin';

/** The agent CLIs: every one's status, then OpenCode's providers and sign-in. */
const app = new Hono();

app.use('*', trustedOrigin);

function fail(e: unknown, fallback: string) {
	const status = e instanceof OpenCodeError ? e.status : 502;

	return { body: { error: e instanceof Error ? e.message : fallback }, status: status as 400 | 404 | 502 | 504 };
}

/** Every known agent: installed, version, sign-in state. `?refresh=1` checks again and lists the models afresh. */
app.get('/', async (c) => c.json({ agents: await agentStatuses(c.req.query('refresh') === '1') }));

/**
 * One provider's usage limits, by its key (`cli:claude-code`, `opencode:opencode-go`, URL-encoded). A read is kept
 * for a minute; `?refresh=1` reads afresh.
 */
app.get('/limits/:key', async (c) => {
	const ref = parseProviderKey(c.req.param('key'));

	if (!ref) return c.json({ error: 'That is not a provider key.' }, 400);

	return c.json(await providerLimits.read(ref, c.req.query('refresh') === '1'));
});

app.get('/providers', async (c) => {
	try {
		return c.json({ providers: await opencode.providers() });
	} catch (e) {
		const { body, status } = fail(e, 'Could not list providers.');

		return c.json(body, status);
	}
});

const inputsSchema = z.record(z.string().max(100), z.string().max(2000)).default({});
const keySchema = z.object({ key: z.string().trim().min(1).max(4000), inputs: inputsSchema });

app.put('/providers/:id/key', async (c) => {
	const parsed = keySchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'Paste an API key.' }, 400);

	try {
		await opencode.setKey(c.req.param('id'), parsed.data.key, parsed.data.inputs);
		forgetAgentModels();

		return c.json({ providers: await opencode.providers() });
	} catch (e) {
		const { body, status } = fail(e, 'Could not save the key.');

		return c.json(body, status);
	}
});

app.delete('/providers/:id', async (c) => {
	try {
		await opencode.remove(c.req.param('id'));
		forgetAgentModels();

		return c.json({ providers: await opencode.providers() });
	} catch (e) {
		const { body, status } = fail(e, 'Could not remove the provider.');

		return c.json(body, status);
	}
});

const oauthSchema = z.object({ method: z.number().int().min(0).max(50), inputs: inputsSchema });

app.post('/providers/:id/oauth', async (c) => {
	const parsed = oauthSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'invalid body' }, 400);

	try {
		return c.json(await opencode.startOAuth(c.req.param('id'), parsed.data.method, parsed.data.inputs));
	} catch (e) {
		const { body, status } = fail(e, 'Could not start the sign-in.');

		return c.json(body, status);
	}
});

/** A finished sign-in connected a provider, so the model list is listed again. */
function signedIn(state: AgentOAuthStatus): AgentOAuthStatus {
	if (state.status === 'complete') forgetAgentModels();

	return state;
}

app.get('/oauth/:attempt', (c) => {
	const state = opencode.attempt(c.req.param('attempt'));

	return state ? c.json(signedIn(state)) : c.json({ error: 'That sign-in expired. Start again.' }, 404);
});

app.post('/oauth/:attempt/code', async (c) => {
	const parsed = z.object({ code: z.string().trim().min(1).max(4000) }).safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'Paste the code.' }, 400);

	try {
		return c.json(signedIn(await opencode.submitCode(c.req.param('attempt'), parsed.data.code)));
	} catch (e) {
		const { body, status } = fail(e, 'Sign-in failed.');

		return c.json(body, status);
	}
});

app.delete('/oauth/:attempt', (c) => {
	opencode.cancel(c.req.param('attempt'));

	return c.json({ ok: true });
});

/**
 * Runs the agent's own `step` command as a setup job: its fixed install or sign-in command from the adapter —
 * nothing a request sends is ever run. One job per agent at a time.
 */
async function startJob(c: Context, step: SetupStep): Promise<Response> {
	const agent = agentById(c.req.param('id'));

	if (!agent) return c.json({ error: 'That is not an agent CLI.' }, 404);

	try {
		return c.json({ job: await startSetupJob(agent, step) });
	} catch (e) {
		return setupFailure(c, e, 'The job could not be started.');
	}
}

/** The error a setup job failure answers with: its message, never a stack or an internal path. */
function setupFailure(c: Context, e: unknown, fallback: string): Response {
	return c.json({ error: e instanceof Error ? e.message : fallback }, e instanceof SetupJobError ? e.status : 500);
}

app.post('/:id/install', (c) => startJob(c, 'install'));

app.post('/:id/sign-in', (c) => startJob(c, 'sign-in'));

/** A setup job: its state, the redacted tail of what the CLI printed, and the sign-in URL it gave. */
app.get('/jobs/:job', (c) => {
	const job = getSetupJob(c.req.param('job'));

	return job ? c.json(job) : c.json({ error: 'That setup job is no longer known.' }, 404);
});

const inputSchema = z.object({ text: z.string().min(1).max(4000) });

/** A pasted sign-in code or token, written to the CLI's stdin and kept out of the job's reported output. */
app.post('/jobs/:job/input', async (c) => {
	const parsed = inputSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'Send the text to paste.' }, 400);

	try {
		return c.json(await setupJobInput(c.req.param('job'), parsed.data.text));
	} catch (e) {
		return setupFailure(c, e, 'The input could not be sent.');
	}
});

/** Stops a running setup job: its whole process group is killed. */
app.delete('/jobs/:job', (c) => {
	try {
		cancelSetupJob(c.req.param('job'));

		return c.json({ ok: true });
	} catch (e) {
		return setupFailure(c, e, 'The job could not be stopped.');
	}
});

export default app;
