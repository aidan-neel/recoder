import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus, AgentSetupJob } from '@recoder/shared';
import type { AgentAdapter, AgentSetup } from '../../../src/agents/contract';
import {
	cancelSetupJob,
	getSetupJob,
	SetupJobError,
	setupJobInput,
	startSetupJob,
	type SetupStep
} from '../../../src/agents/setup/setup-jobs';
import { restoreEnvAfterEach } from '../../helpers/env';
import { allGone } from '../../helpers/fake-claude';
import { fakeBin } from '../../helpers/fake-bin';
import { whenFound, whenFileExists } from '../../helpers/when-found';

restoreEnvAfterEach(['HOME']);

/**
 * A fake CLI in the shape of `fakeBin`'s scripts, dispatched on its first argument: `done` answers and exits;
 * `url` prints a sign-in URL, reads one pasted code from stdin, echoes it and exits; `token` prints credentials
 * the job output must redact; `spawn` starts `sleep 60`, writes `<own pid> <child pid>` to `FAKE_SETUP_PIDS` and
 * waits; `wait` sleeps a minute.
 */
const SCRIPT = `#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';

const [mode] = process.argv.slice(2);

if (mode === 'done') {
	console.log('the installer finished');
	process.exit(0);
}

if (mode === 'url') {
	console.log('Sign in at https://setup-fake.test/device.');
	console.log('Paste the code:');
	for await (const line of console) {
		console.log('got code ' + line.trim());
		process.exit(0);
	}
	process.exit(2);
}

if (mode === 'token') {
	console.log('Authorization: Bearer sk-setup-fake-credential-0123456789');
	console.error('token ghp_setupfakecredential0123456789');
	process.exit(0);
}

if (mode === 'spawn') {
	const child = Bun.spawn(['sleep', '60']);
	writeFileSync(process.env.FAKE_SETUP_PIDS, process.pid + ' ' + child.pid);
	await child.exited;
	process.exit(0);
}

if (mode === 'wait') {
	await Bun.sleep(60000);
	process.exit(0);
}

if (mode === 'tail') {
	console.log('https://setup-fake.test/first');
	for (let i = 0; i < 400; i++) console.log('line ' + i);
	process.exit(0);
}

process.exit(2);
`;

const FAKE_CREDENTIAL = 'sk-setup-fake-credential-0123456789';
const FAKE_TOKEN = 'ghp_setupfakecredential0123456789';

let serial = 0;

/** The jobs a test started, so `afterEach` can stop whatever is still running. */
const started: string[] = [];

afterEach(() => {
	for (const id of started.splice(0)) cancelSetupJob(id);
});

/**
 * An adapter only as much as the job runner uses: an id, a name, `setup`, `setupEnv` and a `detect` that reports
 * the fake binary's path and counts its refreshes. Everything else throws: the runner must not call it.
 */
function fakeAgent(
	env: Record<string, string>,
	path: string | null,
	setup: AgentSetup
): AgentAdapter & { refreshes: number } {
	const agent: AgentAdapter & { refreshes: number } = {
		id: `setup-fake-${++serial}`,
		name: 'Setup Fake',
		processCeiling: null,
		signInFix: '',
		readsImages: false,
		setup,
		refreshes: 0,
		detect(refresh = false): Promise<AgentStatus> {
			if (refresh) agent.refreshes++;

			return Promise.resolve({
				id: agent.id,
				name: agent.name,
				installed: !!path,
				version: null,
				path,
				error: null,
				install: '',
				signedIn: null,
				login: null,
				providers: false,
				config: null,
				setup: { install: !!setup.install, signIn: !!setup.signIn }
			});
		},
		quickStatus() {
			return agent.detect();
		},
		installed: () => path !== null,
		models: () => Promise.reject(new Error('not called')),
		fixedModels: () => null,
		modelSettings: () => ({}),
		complete: () => Promise.reject(new Error('not called')),
		openRun: () => Promise.reject(new Error('not called')),
		setupEnv: () => env,
		describeFailure: (err) => ({ reason: err.message }),
		stop() {}
	};

	return agent;
}

/** A fake `setup-fake` on PATH plus a temp HOME: the env `setupEnv` hands a job, and nothing else. */
async function fakeEnv(): Promise<{ env: Record<string, string>; binDir: string }> {
	const dir = await mkdtemp(join(tmpdir(), 'setup-test-'));

	process.env.HOME = join(dir, 'home');

	const { env } = await fakeBin('setup-fake', SCRIPT);

	return { env: { ...env, HOME: process.env.HOME }, binDir: dir };
}

/** The binary `detect` reports for a sign-in step's argv substitution. */
function fakeBinPath(env: Record<string, string>): string {
	return `${(env.PATH ?? '').split(':')[0]}/setup-fake`;
}

/** The job once it leaves `running`. */
function settled(id: string, afterMs = 10_000): Promise<AgentSetupJob> {
	return whenFound(
		() => {
			const job = getSetupJob(id);

			return job && job.status !== 'running' ? job : null;
		},
		{ afterMs, waitingFor: 'the job to settle' }
	);
}

/** Starts the job and records it for `afterEach` cleanup. */
async function start(
	env: Record<string, string>,
	path: string | null,
	setup: AgentSetup,
	step: SetupStep,
	deadlineMs?: number
): Promise<{ job: AgentSetupJob; agent: AgentAdapter & { refreshes: number } }> {
	const agent = fakeAgent(env, path, setup);
	const job = await startSetupJob(agent, step, deadlineMs);

	started.push(job.id);

	return { job, agent };
}

test('an install job runs the adapter’s installer to done and checks the agent’s status again', async () => {
	const { env } = await fakeEnv();
	const { job, agent } = await start(env, null, { install: { argv: ['setup-fake', 'done'] }, signIn: null }, 'install');

	const done = await settled(job.id);

	expect(done.status).toBe('done');
	expect(done.step).toBe('install');
	expect(done.output).toContain('the installer finished');
	expect(agent.refreshes).toBe(1);
});

test('a sign-in job surfaces the URL the CLI printed and takes the pasted code, which the output redacts', async () => {
	const { env } = await fakeEnv();

	const { job } = await start(
		env,
		fakeBinPath(env),
		{ install: null, signIn: { argv: ['setup-fake', 'url'], needsInput: true } },
		'sign-in'
	);

	expect(job.needsInput).toBe(true);

	const url = await whenFound(() => getSetupJob(job.id)?.url ?? null, {
		afterMs: 5_000,
		waitingFor: 'the sign-in URL'
	});

	expect(url).toBe('https://setup-fake.test/device');

	const answered = await setupJobInput(job.id, 'PASTED-CODE-SECRET-1');
	const done = await settled(job.id);

	expect(answered.id).toBe(job.id);
	expect(done.status).toBe('done');
	expect(done.output).toContain('got code [redacted]');
	expect(done.output).not.toContain('PASTED-CODE-SECRET-1');
});

test('the output redacts credentials the CLI printed', async () => {
	const { env } = await fakeEnv();
	const { job } = await start(env, null, { install: { argv: ['setup-fake', 'token'] }, signIn: null }, 'install');

	const done = await settled(job.id);

	expect(done.output).not.toContain(FAKE_CREDENTIAL);
	expect(done.output).not.toContain(FAKE_TOKEN);
	expect(done.output).toContain('[redacted]');
});

test('cancelling a job kills its whole process group', async () => {
	const { env, binDir } = await fakeEnv();
	const pids = join(binDir, 'job.pids');

	const { job } = await start(
		env,
		fakeBinPath(env),
		{ install: null, signIn: { argv: ['setup-fake', 'spawn'], env: { FAKE_SETUP_PIDS: pids } } },
		'sign-in'
	);

	await whenFileExists(pids);
	cancelSetupJob(job.id);

	const done = await settled(job.id);
	const pidList = (await readFile(pids, 'utf8')).trim().split(' ').map(Number);

	expect(done.status).toBe('cancelled');
	expect(await allGone(pidList)).toBe(true);
});

test('a job that outlives its deadline fails as taking too long', async () => {
	const { env } = await fakeEnv();

	const { job } = await start(env, null, { install: { argv: ['setup-fake', 'wait'] }, signIn: null }, 'install', 100);

	const done = await settled(job.id);

	expect(done.status).toBe('failed');
	expect(done.error).toContain('took too long');
});

test('a second job for the same agent is refused while one runs', async () => {
	const { env } = await fakeEnv();

	const setup = {
		install: { argv: ['setup-fake', 'wait'] },
		signIn: { argv: ['setup-fake', 'wait'] }
	};

	const agent = fakeAgent(env, null, setup);

	const job = await startSetupJob(agent, 'install');

	started.push(job.id);

	await expect(startSetupJob(agent, 'sign-in')).rejects.toMatchObject({ status: 409 });
});

test('a job for a step the adapter does not offer is refused before anything runs', async () => {
	const { env } = await fakeEnv();
	const agent = fakeAgent(env, null, { install: { argv: ['setup-fake', 'done'] }, signIn: null });

	await expect(startSetupJob(agent, 'sign-in')).rejects.toBeInstanceOf(SetupJobError);
});

test('input for a job that finished, or one that does not read it, is refused', async () => {
	const { env } = await fakeEnv();
	const { job } = await start(env, null, { install: { argv: ['setup-fake', 'done'] }, signIn: null }, 'install');

	await expect(setupJobInput(job.id, 'x')).rejects.toMatchObject({ status: 400 });
	await settled(job.id);
	await expect(setupJobInput(job.id, 'x')).rejects.toMatchObject({ status: 409 });
});

describe('the output tail', () => {
	test('keeps only the last ~200 lines but the first URL it printed', async () => {
		const { env } = await fakeEnv();
		const { job } = await start(env, null, { install: { argv: ['setup-fake', 'tail'] }, signIn: null }, 'install');

		const done = await settled(job.id);
		const lines = done.output.split('\n');

		expect(lines.length).toBeLessThanOrEqual(201);
		expect(done.output).not.toContain('line 0');
		expect(done.output).toContain('line 399');
		expect(done.url).toBe('https://setup-fake.test/first');
	});
});
