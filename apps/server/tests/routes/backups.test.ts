import { expect, test } from 'bun:test';
import { requestFrom } from '../helpers/local-app';

test('a remote browser that has not claimed the server cannot read backups or change policy', async () => {
	const remote = '100.64.0.7';

	for (const method of ['GET', 'POST']) {
		const response = await requestFrom(remote, '/api/server/backups', { method });

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ kind: 'setup-locked' });
	}
});
