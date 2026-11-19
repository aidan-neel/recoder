import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import type { ServerCheck, SetupChecklist } from '@recoder/shared';
import { Hono } from 'hono';
import { recordSignIn } from '../../src/accounts/account-store';
import { requireSession } from '../../src/accounts/enforcement';
import { createSession, SESSION_COOKIE } from '../../src/accounts/sessions';
import { readServerChecks, startServerChecks } from '../../src/deploy/diagnostics/checks';
import { initializeSetupChecklist } from '../../src/deploy/setup/checklist';
import { setReviewOverrides } from '../../src/review/session/review-settings';
import { createSetupChecklistRoutes } from '../../src/routes/setup-checklist';
import { closeStorage, collection } from '../../src/storage/backend';
import { restoreEnvAfterEach } from '../helpers/env';
import { createOwnerAccount } from '../helpers/fake-forge-oauth';
import { whenFound } from '../helpers/when-found';

const LOOPBACK = { requestIP: () => ({ address: '127.0.0.1' }) };
const PRIVATE = 'test-credential-not-for-output';
const POSTGRES = `postgresql://operator:${PRIVATE}@storage.example/recoder`;

restoreEnvAfterEach(['RECODER_PUBLIC_URL']);

beforeEach(async () => {
	process.env.RECODER_PUBLIC_URL = 'https://recoder.example';
	await collection('update_state').clear();
});

afterEach(async () => {
	setReviewOverrides({});
	await collection('accounts').clear();
	await collection('sessions').clear();
});

test('first startup with no admin does not treat a later sign-in and model pick as an existing install', async () => {
	await initializeSetupChecklist();
	await createOwnerAccount();
	setConfiguredModel();
	await closeStorage();
	await initializeSetupChecklist();

	const app = setupApp();
	const response = await app.request('/api/setup', { headers: { cookie: await cookieFor('owner') } });
	const checklist = (await response.json()) as SetupChecklist;

	expect(checklist.complete).toBe(false);

	expect(checklist.steps.map(({ id, done }) => [id, done])).toEqual([
		['claim', true],
		['address', true],
		['admin', true],
		['provider', true],
		['model', true],
		['storage', false],
		['check', false]
	]);

	expect(checklist.steps.find(({ id }) => id === 'address')?.fact).toBe('recoder.example · behind your proxy');
	expect(checklist.steps.find(({ id }) => id === 'model')?.fact).toBe('GPT-6 Luna · Low');
});

test('an existing install is grandfathered, and restart never clears completion', async () => {
	await createOwnerAccount();
	setConfiguredModel();
	await initializeSetupChecklist();
	await closeStorage();
	setReviewOverrides({});
	await initializeSetupChecklist();

	const response = await setupApp().request('/api/setup', { headers: { cookie: await cookieFor('owner') } });

	expect(await response.json()).toMatchObject({ complete: true });
});

test('a member is told setup is complete without loading the administrator diagnostics', async () => {
	await createOwnerAccount();

	const result = await recordSignIn({
		target: { provider: 'github', host: null },
		user: { remoteId: '15', login: 'member', name: null, avatarUrl: null },
		token: { refreshToken: null, expiresAt: null },
		linkTo: null
	});

	if (result.kind === 'rejected') throw new Error('Test member could not sign in');

	const readAddress = mock(() => {
		throw new Error('A member should not see the stored public address');
	});

	const app = setupApp({ readAddress });
	const response = await app.request('/api/setup', { headers: { cookie: await cookieFor(result.account.id) } });

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ complete: true, steps: [] });
	expect(readAddress).not.toHaveBeenCalled();
});

test('a remote browser must unlock before confirming storage or finishing setup', async () => {
	const app = setupApp();
	const checklist = (await (await app.request('/api/setup')).json()) as SetupChecklist;

	expect(checklist.steps[0]).toMatchObject({ id: 'claim', done: false });

	const responses = await Promise.all([
		app.request('/api/setup/finish', { method: 'POST' }),
		app.request('/api/setup/storage', postStorage({ kind: 'builtin' }))
	]);

	for (const response of responses) {
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ kind: 'setup-locked' });
	}
});

test('built-in confirmation and completion survive reopening storage, and failures prevent finishing', async () => {
	await initializeSetupChecklist();
	await createOwnerAccount();
	setConfiguredModel();

	const app = setupApp();
	const cookie = await cookieFor('owner');
	const confirm = await app.request('/api/setup/storage', postStorage({ kind: 'builtin' }, cookie), LOOPBACK);

	expect(confirm.status).toBe(200);

	await closeStorage();

	const earlier = (await (await app.request('/api/setup', { headers: { cookie } })).json()) as SetupChecklist;

	expect(earlier.steps.find(({ id }) => id === 'storage')).toMatchObject({ done: true });
	expect((await app.request('/api/setup/finish', { method: 'POST', headers: { cookie } })).status).toBe(409);

	const gate = Promise.withResolvers<ServerCheck>();

	await startServerChecks((id) =>
		id === 'database' ? gate.promise : Promise.resolve({ id, state: 'ok', detail: '' })
	);

	const waiting = await app.request('/api/setup/finish', { method: 'POST', headers: { cookie } });

	gate.resolve({ id: 'database', state: 'fail', detail: '' });
	await whenFound(checksSettled);

	expect(waiting.status).toBe(409);
	expect(await waiting.json()).toEqual({ error: 'Wait for the server checks to finish.' });

	const failed = await app.request('/api/setup/finish', { method: 'POST', headers: { cookie } });

	expect(failed.status).toBe(409);
	expect(await failed.json()).toEqual({ error: 'Resolve the failed server checks first.' });

	await startServerChecks(async (id) => ({ id, state: 'warn', detail: '' }), 'database');
	await whenFound(checksSettled);

	const finished = await app.request('/api/setup/finish', { method: 'POST', headers: { cookie } });
	const body = (await finished.json()) as SetupChecklist;

	expect(finished.status).toBe(200);
	expect(body.complete).toBe(true);
	expect(body.steps.find(({ id }) => id === 'check')).toMatchObject({ done: true, fact: '1 warning' });

	await closeStorage();

	const persisted = await app.request('/api/setup', { headers: { cookie } });

	expect(await persisted.json()).toMatchObject({ complete: true });
});

test('PostgreSQL selection directs the operator to offline migration without disclosing credentials', async () => {
	const app = setupApp();

	const response = await app.request(
		'/api/setup/storage',
		postStorage({ kind: 'postgres', url: POSTGRES, import: true }),
		LOOPBACK
	);

	expect(response.status).toBe(409);

	const body = await response.text();

	expect(body).toContain('offline migration');
	expect(body).not.toContain(PRIVATE);
});

function setupApp(options?: Parameters<typeof createSetupChecklistRoutes>[0]): Hono {
	const app = new Hono();

	app.use('/api/*', requireSession);
	app.route('/api/setup', createSetupChecklistRoutes(options));

	return app;
}

function postStorage(body: object, cookie = ''): RequestInit {
	return { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) };
}

async function cookieFor(accountId: string): Promise<string> {
	return `${SESSION_COOKIE}=${(await createSession(accountId)).token}`;
}

function setConfiguredModel(): void {
	setReviewOverrides({
		models: [
			{
				id: 'test-model',
				label: 'GPT-6 Luna',
				model: 'gpt-6-luna',
				baseUrl: 'https://provider.example/v1',
				efforts: ['low', 'high']
			}
		],
		orchestratorEffort: 'low'
	});
}

async function checksSettled(): Promise<true | null> {
	return (await readServerChecks()).running ? null : true;
}
