import { expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliverReport, prepareOutputFile, type ReportDestination } from '../../../src/cli/output/deliver';
import { OUTPUT, finding, report } from './fixtures';

function recordDestination() {
	const stdout: string[] = [];
	const files = new Map<string, string>();

	const destination: ReportDestination = {
		writeStdout: async (text) => {
			stdout.push(text);
		},
		writeFile: async (path, text) => {
			files.set(path, text);
		}
	};

	return { stdout, files, destination };
}

const withFindings = report({
	findings: [finding({ severity: 'error' }), finding({ id: 'low', severity: 'info' })],
	unconfirmed: [finding({ id: 'u' })]
});

test('without a file the filtered report goes to standard output and nothing is written to disk', async () => {
	const { stdout, files, destination } = recordDestination();

	await deliverReport(withFindings, { ...OUTPUT, minSeverity: 'error' }, destination);

	expect(files.size).toBe(0);
	expect(stdout).toHaveLength(1);
	expect(JSON.parse(stdout[0]).findings).toHaveLength(1);
});

test('with a file the report goes to the file and standard output gets one receipt line', async () => {
	const { stdout, files, destination } = recordDestination();

	await deliverReport(withFindings, { ...OUTPUT, file: '/tmp/review.json', minSeverity: 'error' }, destination);

	expect(JSON.parse(files.get('/tmp/review.json') ?? '').findings).toHaveLength(1);
	expect(stdout).toHaveLength(1);
	expect(stdout[0].endsWith('\n')).toBe(true);

	expect(JSON.parse(stdout[0])).toEqual({
		schemaVersion: 1,
		outcome: 'complete',
		findings: 1,
		unconfirmed: 0,
		reportFile: '/tmp/review.json'
	});
});

test('a file that cannot be written fails the command and prints no receipt', async () => {
	const stdout: string[] = [];

	const destination: ReportDestination = {
		writeStdout: async (text) => {
			stdout.push(text);
		},
		writeFile: () => Promise.reject(new Error('disk full'))
	};

	await expect(deliverReport(report(), { ...OUTPUT, file: '/tmp/review.json' }, destination)).rejects.toThrow(
		'/tmp/review.json: disk full'
	);

	expect(stdout).toEqual([]);
});

test('a missing output file is fine, since it will be created', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'recoder-output-'));

	await expect(prepareOutputFile(join(directory, 'nested', 'review.json'))).resolves.toBeUndefined();
	rmSync(directory, { recursive: true });
});

test.skipIf(process.getuid?.() === 0)(
	'an output file that cannot be checked is a usage error naming the path',
	async () => {
		const directory = mkdtempSync(join(tmpdir(), 'recoder-output-'));
		const file = join(directory, 'review.json');

		chmodSync(directory, 0o000);

		try {
			await expect(prepareOutputFile(file)).rejects.toThrow(file);
		} finally {
			chmodSync(directory, 0o700);
			rmSync(directory, { recursive: true });
		}
	}
);
