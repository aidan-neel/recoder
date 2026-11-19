import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { probeServerCheck } from '../../../src/deploy/diagnostics/probes';
import { recordWebhookDelivery } from '../../../src/deploy/diagnostics/webhooks';
import { clearToken, setToken } from '../../../src/forge/tokens';
import { closeStorage, collection } from '../../../src/storage/backend';
import { restoreEnvAfterEach } from '../../helpers/env';
import { createOwnerAccount } from '../../helpers/fake-forge-oauth';

restoreEnvAfterEach(['RECODER_PUBLIC_URL']);

afterEach(async () => {
	mock.restore();
	clearToken('github');
	await collection('accounts').clear();
	await collection('update_state').clear();
});

test('reachability requires a Recoder health answer, not an unrelated successful proxy page', async () => {
	process.env.RECODER_PUBLIC_URL = 'https://recoder.example';

	const fetch = spyOn(globalThis, 'fetch');

	fetch.mockResolvedValueOnce(new Response('login page', { status: 200 }));
	fetch.mockResolvedValueOnce(Response.json({ ok: true, name: 'recoder' }));

	expect(await probeServerCheck('reachable')).toMatchObject({ state: 'fail' });
	expect(await probeServerCheck('reachable')).toMatchObject({ state: 'ok' });
	expect(fetch.mock.calls[0]?.[0]?.toString()).toBe('https://recoder.example/health');
	expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
});

test('forge scopes produce a warning without echoing the token or response', async () => {
	const privateToken = 'github-test-credential-value';

	await createOwnerAccount();
	setToken('github', privateToken);

	const request = spyOn(globalThis, 'fetch').mockResolvedValue(
		Response.json({ id: 7, login: 'octocat', privateToken }, { headers: { 'x-oauth-scopes': 'read:user, read:org' } })
	);

	const result = await probeServerCheck('forge');

	expect(result.state).toBe('warn');
	expect(JSON.stringify(result)).not.toContain(privateToken);
	expect(request).toHaveBeenCalledTimes(1);
});

test('webhook activity remains visible after the storage connection is reopened', async () => {
	await recordWebhookDelivery();
	await closeStorage();

	expect(await probeServerCheck('webhooks')).toMatchObject({ state: 'ok' });
});

test('the built-in database check writes successfully without leaving probe records', async () => {
	expect(await probeServerCheck('database')).toMatchObject({ state: 'ok' });
	expect(await collection('update_state').list()).toEqual([]);
});
