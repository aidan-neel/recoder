import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from '../../src/cli/exit';
import { childEnvironment } from './child-env';
import { runMain } from './run-main';

const ESCAPE = '\u001b[';

const folders: string[] = [];

afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function temporaryFolder(): string {
	const folder = realpathSync(mkdtempSync(join(tmpdir(), 'recoder-main-')));

	folders.push(folder);

	return folder;
}

/** Runs `recoder` with these arguments on a machine with no agent and no model, and returns how it ended. */
function recoder(args: string[], cwd: string = temporaryFolder()) {
	return runMain(args, { cwd, env: { ...childEnvironment(temporaryFolder()), RECODER_DEVIN_BIN: '' } });
}

test('a command prints a view for a person, and one line of JSON with -p', async () => {
	const person = await recoder(['runs']);
	const program = await recoder(['runs', '-p']);

	expect(person.stdout).toContain('No reviews yet');
	expect(program.stdout).toBe('[]\n');
});

test('-p is read wherever it stands on the command line', async () => {
	expect((await recoder(['-p', 'runs'])).stdout).toBe('[]\n');
});

test('output that is not a terminal holds no escape codes', async () => {
	const { stdout, exitCode } = await recoder(['review', '--help']);

	expect(exitCode).toBe(EXIT.ok);
	expect(stdout).toContain('--uncommitted');
	expect(stdout).not.toContain(ESCAPE);
});

test('a usage error names what was probably meant; for a program it is one recoder: line and the hint', async () => {
	const person = await recoder(['revew']);
	const program = await recoder(['revew', '-p']);

	expect(person.exitCode).toBe(EXIT.usage);
	expect(person.stdout).toBe('');
	expect(person.stderr).toContain('recoder review');
	expect(program.stderr.split('\n')[0]).toStartWith('recoder: unknown command "revew"');
});

test('doctor -p prints the report a program reads, and says a machine with no model is not ready', async () => {
	const { stdout, exitCode } = await recoder(['doctor', '-p']);

	expect(exitCode).toBe(EXIT.notReady);

	expect(JSON.parse(stdout)).toMatchObject({
		ok: false,
		checks: expect.arrayContaining([expect.objectContaining({ id: 'review-model', ok: false })])
	});
});

test('init --project installs the skill and RECODER.md in the folder, and exits not ready while no model is chosen', async () => {
	const project = temporaryFolder();
	const { stdout, exitCode } = await recoder(['init', '--project', '--agent', 'claude', '-p'], project);

	expect(exitCode).toBe(EXIT.notReady);
	expect(existsSync(join(project, '.claude', 'skills', 'recoder', 'SKILL.md'))).toBe(true);
	expect(existsSync(join(project, 'RECODER.md'))).toBe(true);

	expect(JSON.parse(stdout)).toMatchObject({
		scope: 'project',
		ready: false,
		steps: [
			{ id: 'skill', state: 'done', path: join(project, '.claude', 'skills', 'recoder') },
			{ id: 'guidelines', state: 'done' },
			{ id: 'review-model', state: 'skipped' },
			{ id: 'machine', state: 'unchanged' }
		]
	});
});

test('init with no scope and nobody to ask is a usage error that writes nothing', async () => {
	const project = temporaryFolder();
	const { exitCode, stderr } = await recoder(['init'], project);

	expect(exitCode).toBe(EXIT.usage);
	expect(stderr).toContain('--project');
	expect(existsSync(join(project, '.claude'))).toBe(false);
});

test('init --global --mcp is refused, since .mcp.json belongs to a project', async () => {
	expect((await recoder(['init', '--global', '--mcp'])).exitCode).toBe(EXIT.usage);
});
