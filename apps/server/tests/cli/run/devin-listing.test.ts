import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevinAgent } from '../../../src/agents/devin/devin';
import { fakeBin } from '../../helpers/fake-bin';
import { childEnvironment } from '../child-env';
import { HANGING_DEVIN, startedProcess } from './hanging-devin';

test('aborting a Devin model listing kills its process and rejects the listing', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'recoder-devin-listing-'));
	const { env } = await fakeBin('devin', HANGING_DEVIN);
	const agent = new DevinAgent({ ...childEnvironment(dir), PATH: env.PATH, FAKE_DEVIN_DIR: dir });
	const controller = new AbortController();
	const started = startedProcess(dir);
	const listing = agent.models(controller.signal).catch((error: unknown) => error);

	const pid = await started;

	controller.abort();

	expect(await listing).toMatchObject({ message: expect.stringContaining('cancel') });
	expect(() => process.kill(pid, 0)).toThrow();
});
