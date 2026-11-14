import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { ModelSettings, MyModels, UsageReport } from '@recoder/shared';
import type { StoredAccount } from '../../src/accounts/account-records';
import { createSession } from '../../src/accounts/sessions';
import { claudeCode } from '../../src/agents/claude-code/claude-code';
import { copilot } from '../../src/agents/copilot/copilot';
import { devin } from '../../src/agents/devin/devin';
import { opencode } from '../../src/agents/opencode/opencode';
import { forgetAgentModels } from '../../src/agents/registry';
import { collection } from '../../src/storage/backend';
import { modelCalls } from '../../src/store';
import { createOwnerAccount, useFakeForges } from '../helpers/fake-forge-oauth';
import { sendAs } from '../helpers/local-app';
import { claudeCodeModel } from '../helpers/model-entries';
import { isolateSettings } from '../helpers/settings-env';

useFakeForges();
isolateSettings();

const [sonnet, opus] = ['sonnet', 'opus'].map(claudeCodeModel);
const MEMBER_ID = 'member:github::hubot';

let mocks: { mockRestore(): void }[] = [];

beforeEach(() => {
	mocks = [
		spyOn(claudeCode, 'models').mockResolvedValue([sonnet, opus]),
		spyOn(opencode, 'models').mockResolvedValue([]),
		spyOn(copilot, 'models').mockResolvedValue([]),
		spyOn(devin, 'models').mockResolvedValue([])
	];

	forgetAgentModels();
});

afterEach(async () => {
	for (const mock of mocks) mock.mockRestore();
	forgetAgentModels();
	await collection('member_models').clear();
});

async function signedInAs(accountId: string): Promise<string> {
	return `recoder_session=${(await createSession(accountId)).token}`;
}

/** The admin's session cookie, with the admin account made. */
async function adminCookie(): Promise<string> {
	await createOwnerAccount();

	return signedInAs('owner');
}

/** A member `hubot` who has signed in, and their session cookie. */
async function memberCookie(): Promise<string> {
	const at = '2026-01-01T00:00:00.000Z';

	await collection<StoredAccount>('accounts').set({
		id: MEMBER_ID,
		role: 'member',
		name: 'hubot',
		avatarUrl: null,
		createdAt: at,
		forges: [
			{
				provider: 'github',
				host: null,
				login: 'hubot',
				name: null,
				avatarUrl: null,
				linkedAt: at,
				remoteId: '21',
				refresh: null
			}
		]
	});

	return signedInAs(MEMBER_ID);
}

const saveSettings = (cookie: string, body: object, query = '') =>
	sendAs(`/api/settings/models${query}`, 'PATCH', cookie, body);

const readSettings = async (cookie: string, query = '') =>
	(await (await sendAs(`/api/settings/models${query}`, 'GET', cookie)).json()) as ModelSettings;

const mine = async (cookie: string) => (await (await sendAs('/api/me/models', 'GET', cookie)).json()) as MyModels;

const enforced = (id: string) => ({
	kind: 'enforced' as const,
	orchestratorModelId: id,
	orchestratorEffort: 'low' as const,
	specialistModelId: null,
	specialistEffort: null
});

describe('the signed-in person’s models', () => {
	test('a member saves their own picks while the admin lets them choose', async () => {
		const admin = await adminCookie();
		const member = await memberCookie();

		await saveSettings(admin, { orchestratorModelId: sonnet.id });

		const response = await sendAs('/api/me/models', 'PATCH', member, { orchestratorModelId: opus.id });

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ orchestratorModelId: opus.id, enforced: false });
		expect(await mine(member)).toMatchObject({ orchestratorModelId: opus.id });
		expect(await mine(admin)).toMatchObject({ orchestratorModelId: sonnet.id });
	});

	test('a member’s save is refused with models-enforced while the admin enforces models', async () => {
		const admin = await adminCookie();
		const member = await memberCookie();

		expect((await saveSettings(admin, { modelPolicy: enforced(sonnet.id) })).status).toBe(200);

		const response = await sendAs('/api/me/models', 'PATCH', member, { orchestratorModelId: opus.id });

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'models-enforced' });
		expect(await mine(member)).toMatchObject({ orchestratorModelId: sonnet.id, enforced: true });
	});

	test('the admin’s save through this route changes the server’s settings', async () => {
		const admin = await adminCookie();

		await sendAs('/api/me/models', 'PATCH', admin, { orchestratorModelId: opus.id, orchestratorEffort: 'high' });

		expect(await readSettings(admin)).toMatchObject({ orchestratorModelId: opus.id, orchestratorEffort: 'high' });
	});

	test('a model the server does not offer is refused for a member', async () => {
		await adminCookie();

		const member = await memberCookie();
		const response = await sendAs('/api/me/models', 'PATCH', member, { orchestratorModelId: 'claude-code:nothing' });

		expect(response.status).toBe(400);
	});

	test('a member can read the model catalog and the settings route still refuses their writes', async () => {
		await adminCookie();

		const member = await memberCookie();
		const response = await sendAs('/api/settings/models', 'GET', member);

		expect(response.status).toBe(200);
		expect(JSON.stringify(await response.json())).not.toMatch(/"apiKey"/);
		expect((await saveSettings(member, { orchestratorModelId: sonnet.id })).status).toBe(403);
	});
});

describe('hidden models', () => {
	test('a hidden model leaves the picker list but stays in the chooser list, and unknown ids are dropped', async () => {
		const admin = await adminCookie();

		const saved = (await (
			await saveSettings(admin, { hiddenModels: [opus.id, 'claude-code:nothing', opus.id] })
		).json()) as ModelSettings;

		expect(saved.hiddenModels).toEqual([opus.id]);
		expect(saved.models.map((model) => model.id)).toEqual([sonnet.id]);
		expect((await readSettings(admin, '?hidden=1')).models.map((model) => model.id)).toEqual([sonnet.id, opus.id]);
	});

	test('a hidden model is refused as a new pick by the admin, a member and the enforced policy', async () => {
		const admin = await adminCookie();
		const member = await memberCookie();

		await saveSettings(admin, { hiddenModels: [opus.id] });

		expect((await saveSettings(admin, { orchestratorModelId: opus.id })).status).toBe(400);
		expect((await saveSettings(admin, { modelPolicy: enforced(opus.id) })).status).toBe(400);
		expect((await sendAs('/api/me/models', 'PATCH', member, { specialistModelId: opus.id })).status).toBe(400);
		expect((await readSettings(admin)).orchestratorModelId).toBeNull();
	});

	test('hiding and picking a model in one save is refused', async () => {
		const admin = await adminCookie();

		expect((await saveSettings(admin, { hiddenModels: [opus.id], orchestratorModelId: opus.id })).status).toBe(400);
	});

	test('a pick saved before its model was hidden keeps working and is still reported', async () => {
		const admin = await adminCookie();
		const member = await memberCookie();

		await saveSettings(admin, { orchestratorModelId: opus.id });
		await sendAs('/api/me/models', 'PATCH', member, { orchestratorModelId: opus.id });
		await saveSettings(admin, { hiddenModels: [opus.id] });

		expect((await mine(admin)).orchestratorModelId).toBe(opus.id);
		expect((await mine(member)).orchestratorModelId).toBe(opus.id);
		expect((await sendAs('/api/me/models', 'PATCH', member, { orchestratorEffort: 'low' })).status).toBe(200);
		expect((await readSettings(admin)).models.map((model) => model.id)).toContain(opus.id);
	});
});

describe('the usage report', () => {
	test('is refused for a member and answered for the admin', async () => {
		await modelCalls.clear();

		const admin = await adminCookie();
		const member = await memberCookie();

		expect((await sendAs('/api/usage', 'GET', member)).status).toBe(403);

		const report = (await (await sendAs('/api/usage', 'GET', admin)).json()) as UsageReport;

		expect(report).toMatchObject({ days: 30, totals: { tokens: 0 } });
		expect(report.daily).toHaveLength(30);
		expect(report.people.map((person) => person.login)).toEqual(['hubot', 'octocat']);
	});

	test('takes 7, 30 or 90 days and refuses any other window', async () => {
		const admin = await adminCookie();

		expect(((await (await sendAs('/api/usage?days=7', 'GET', admin)).json()) as UsageReport).daily).toHaveLength(7);
		expect(((await (await sendAs('/api/usage?days=90', 'GET', admin)).json()) as UsageReport).daily).toHaveLength(90);
		expect((await sendAs('/api/usage?days=5', 'GET', admin)).status).toBe(400);
	});
});
