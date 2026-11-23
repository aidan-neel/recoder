import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecWorkspace } from '../../../../src/sandbox/exec-workspace';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { dependencyApiSource } from '../../../../src/review/pipeline/verify/dependency-api';
import { dependencyProbe } from './dependency-probe';

const initial = process.env.RECODER_DEPENDENCY_GROUNDING;

const candidate: CandidateFinding = {
	id: 'c1',
	candidateId: 'c1',
	valid: true,
	file: 'a.ts',
	line: 1,
	category: 'api-contract',
	severity: 'warning',
	message: '`S3.getObject()` is a missing method'
};

afterEach(() => {
	if (initial === undefined) delete process.env.RECODER_DEPENDENCY_GROUNDING;
	else process.env.RECODER_DEPENDENCY_GROUNDING = initial;
});

test.each([undefined, '0'])(
	'F payload is byte-identical and never looks up dependencies when grounding is off: %s',
	async (value) => {
		if (value === undefined) delete process.env.RECODER_DEPENDENCY_GROUNDING;
		else process.env.RECODER_DEPENDENCY_GROUNDING = value;

		const workspace = {
			runtimes: () => {
				throw new Error('F must never inspect');
			}
		} as unknown as ExecWorkspace;

		expect(await dependencyApiSource(candidate, workspace, 'original payload')).toBe('original payload');
	}
);

test('non-API claims and aborted verification do not invoke the inspector', async () => {
	process.env.RECODER_DEPENDENCY_GROUNDING = '1';

	const workspace = {
		runtimes: () => {
			throw new Error('not relevant');
		}
	} as unknown as ExecWorkspace;

	expect(await dependencyApiSource({ ...candidate, message: 'lost a queued item' }, workspace, 'original')).toBe(
		'original'
	);

	expect(await dependencyApiSource(candidate, workspace, 'original', AbortSignal.abort())).toBe('original');
});

test('lookup data is attached using a separate sandbox owner without investigative runs or verdict settlement', async () => {
	process.env.RECODER_DEPENDENCY_GROUNDING = '1';

	const owners: string[] = [];
	const released: string[] = [];

	const workspace = {
		runtimes: () => ['node'],
		run: async (_command: string, limit: number, _signal: AbortSignal, owner: string) => {
			expect(limit).toBeLessThanOrEqual(5000);
			owners.push(owner);

			return {
				exitCode: 0,
				truncated: false,
				output: JSON.stringify({
					matches: [],
					unavailable: [{ name: '@aws-sdk/client-s3', unavailable: 'not installed' }]
				})
			};
		},
		runInvestigation: () => {
			throw new Error('context must not become proof');
		},
		release: (owner: string) => released.push(owner)
	} as unknown as ExecWorkspace;

	const payload = await dependencyApiSource(candidate, workspace, 'original');

	expect(payload.startsWith('original')).toBe(true);
	expect(payload).toContain('"unavailable":"not installed"');
	expect(owners).toEqual(['dependency-grounding:c1']);
	expect(released).toEqual(owners);
});

test.each(['error', 'malformed', 'oversized', 'timeout'])(
	'lookup failure preserves the verifier session as unavailable context: %s',
	async (mode) => {
		process.env.RECODER_DEPENDENCY_GROUNDING = '1';

		let released = false;

		const workspace = {
			runtimes: () => ['node'],
			run: async () => {
				if (mode === 'error') throw new Error('sandbox unavailable');

				return {
					exitCode: mode === 'timeout' ? null : 0,
					truncated: mode === 'oversized',
					output: mode === 'oversized' ? 'x'.repeat(20000) : 'not json'
				};
			},
			release: () => {
				released = true;
			}
		} as unknown as ExecWorkspace;

		const payload = await dependencyApiSource(candidate, workspace, 'original');

		expect(payload.startsWith('original')).toBe(true);
		expect(payload).not.toContain('x'.repeat(20000));
		expect(released).toBe(true);
	}
);

test('untrusted candidate filenames and claim text stay data in the sandbox command', async () => {
	process.env.RECODER_DEPENDENCY_GROUNDING = '1';

	const dir = await mkdtemp(join(tmpdir(), 'dependency-command-'));
	const file = "a'$(touch OWNED).ts";
	const original = "import {S3} from '@aws-sdk/client-s3';";

	try {
		await writeFile(join(dir, file), original);

		const workspace = {
			runtimes: () => ['node'],
			run: (command: string) => dependencyProbe(['sh', '-c', command], dir),
			release: () => {}
		} as unknown as ExecWorkspace;

		const payload = await dependencyApiSource(
			{ ...candidate, file, message: candidate.message + ' $(touch OWNED)' },
			workspace,
			'original'
		);

		expect(payload).toContain('@aws-sdk/client-s3');
		expect(await Bun.file(join(dir, 'OWNED')).exists()).toBe(false);
		expect(await readFile(join(dir, file), 'utf8')).toBe(original);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
