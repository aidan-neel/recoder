import { parseArgs } from 'node:util';
import { env } from '../../env';
import { serverDataDir } from '../../util/data-dir';
import { createBackup } from './store';
import { restoreBackup } from './restore';

const args = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: { archive: { type: 'string' }, stopped: { type: 'boolean' } }
});

try {
	const [operation] = args.positionals;

	if (!args.values.stopped || args.positionals.length !== 1) {
		throw new Error(
			'Stop Recoder and all its workers first, then pass backup --stopped or restore --archive FILE --stopped.'
		);
	}

	const data = serverDataDir();

	if (operation === 'backup') {
		const backup = await createBackup(data, 'manual', env.RECODER_DATABASE_URL);

		console.log(`Created backup ${backup.id} (data version ${backup.dataVersion}).`);
	} else if (operation === 'restore' && args.values.archive) {
		const restored = await restoreBackup(data, args.values.archive, env.RECODER_DATABASE_URL);

		console.log(`Restored backup ${restored.id} (data version ${restored.dataVersion}).`);
	} else throw new Error('Pass backup --stopped or restore --archive FILE --stopped.');
} catch (error) {
	console.error(error instanceof Error && error.name === 'Error' ? error.message : 'The backup operation failed.');
	process.exitCode = 1;
}
