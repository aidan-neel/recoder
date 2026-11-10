import { CliError } from '../../../src/cli/exit';
import { writeStdout } from '../../../src/cli/output/streams';

const REPORT_BYTES = 5_000_000;

try {
	await writeStdout(`${'x'.repeat(REPORT_BYTES)}\n`);
	process.exitCode = 0;
} catch (error) {
	process.exitCode = error instanceof CliError ? error.exitCode : 99;
}
