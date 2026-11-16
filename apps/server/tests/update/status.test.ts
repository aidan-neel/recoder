import { expect, mock, test } from 'bun:test';
import { createUpdateService } from '../../src/update/service';
import { useTempStore } from '../helpers/temp-store';

useTempStore('recoder-update-status-');

test('concurrent initial status reads share detection and the lightweight HEAD read', async () => {
	const run = mock(async (argv: string[]) => ({
		exitCode: 0,
		stderr: '',
		stdout: argv.includes('--abbrev-ref') ? 'abc\nmain\n' : 'true\n'
	}));

	const service = createUpdateService({ environment: { root: '/test', managed: false, compiledBinary: false }, run });
	const [first, second] = await Promise.all([service.status(), service.status()]);

	expect(first).toEqual(second);
	expect(first.current).toMatchObject({ commit: 'abc', branch: 'main' });
	await service.status();
	expect(run).toHaveBeenCalledTimes(2);
});
