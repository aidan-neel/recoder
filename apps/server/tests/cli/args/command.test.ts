import { expect, test } from 'bun:test';
import { parseInvocation } from '../../../src/cli/args/command';
import { EXIT } from '../../../src/cli/exit';

const RUN_ID = '20261110-153045-a1b2c3';

const OTHER_RUN_ID = '20261110-153045-a1b2c4';

const parse = (...argv: string[]) => parseInvocation(argv, { workingDirectory: '/work', audience: 'program' });

const usageError = expect.objectContaining({ exitCode: EXIT.usage });

test('--help beside a flag that would not parse still prints help', () => {
	expect(parse('review', '--budget', 'huge', '--help')).toEqual({ command: 'help', topic: 'review' });
});

test('help names the command it explains, and the program for anything that is not one', () => {
	expect(parse('help', 'wait')).toEqual({ command: 'help', topic: 'wait' });
	expect(parse('help', 'bogus')).toEqual({ command: 'help', topic: 'main' });
	expect(parse()).toEqual({ command: 'help', topic: 'main' });
});

test('a mistyped command names the one that was probably meant', () => {
	expect(() => parse('revew')).toThrow('recoder review');
});

test('an unknown command is a usage error', () => {
	expect(() => parse('bogus')).toThrow(usageError);
});

test('an unknown command is named in the message', () => {
	expect(() => parse('bogus')).toThrow('"bogus"');
});

test('doctor with no flags is the doctor command', () => {
	expect(parse('doctor')).toEqual({ command: 'doctor' });
});

test('doctor takes no flags', () => {
	expect(() => parse('doctor', '--fix')).toThrow('--fix');
});

const RUN_ID_COMMANDS = ['status', 'wait', 'result', 'cancel'];

const PATH_LIKE_RUN_IDS = [`../${RUN_ID}`, `${RUN_ID}/..`, 'a/b', '..'];

const PATH_CASES = RUN_ID_COMMANDS.flatMap((command) => PATH_LIKE_RUN_IDS.map((runId) => [command, runId]));

test.each(PATH_CASES)('%s refuses the run id %s as a usage error, before anything reads the disk', (command, runId) => {
	expect(() => parse(command, runId)).toThrow(usageError);
});

test('a run command with no run id means the newest run', () => {
	expect(parse('status')).toEqual({ command: 'status', run: { kind: 'newest' } });
});

test('a run command takes part of a run id, to be matched against the runs on disk', () => {
	expect(parse('result', 'a1b2c3')).toMatchObject({ run: { kind: 'part', text: 'a1b2c3' } });
	expect(parse('result', RUN_ID)).toMatchObject({ run: { kind: 'id', runId: RUN_ID } });
});

test('a run command given two run ids names the second', () => {
	expect(() => parse('cancel', RUN_ID, OTHER_RUN_ID)).toThrow(OTHER_RUN_ID);
});

test('skill passes its subcommand and flags on untouched', () => {
	expect(parse('skill', 'install', '--force')).toEqual({ command: 'skill', argv: ['install', '--force'] });
});

test('init reads its scope and a comma-separated list of agents', () => {
	expect(parse('init', '--project', '--agent', 'claude,agents')).toMatchObject({
		command: 'init',
		request: { scope: 'project', agents: ['claude', 'agents'], guidelines: true, mcp: false }
	});
});

test('upgrade reads the release to install, with or without its v, and refuses text that is no release', () => {
	expect(parse('upgrade')).toEqual({ command: 'upgrade', request: { to: null, checkOnly: false } });

	expect(parse('upgrade', '--to', '0.2.0', '--check')).toMatchObject({
		command: 'upgrade',
		request: { to: 'v0.2.0', checkOnly: true }
	});

	expect(() => parse('upgrade', '--to', '../v0.2.0')).toThrow(usageError);
});

test('init refuses both scopes at once', () => {
	expect(() => parse('init', '--project', '--global')).toThrow(usageError);
});

test('models reads --provider as a repeatable, comma-separated list and --search as text', () => {
	expect(parse('models', '--provider', 'OpenAI,Claude Code', '--provider', 'OpenAI', '--search', 'opus')).toEqual({
		command: 'models',
		query: { providers: ['OpenAI', 'Claude Code'], search: 'opus' }
	});
});

test('models with no flags lists every provider and every model', () => {
	expect(parse('models')).toEqual({ command: 'models', query: { providers: null, search: null } });
});

test('models refuses a flag it does not have, and a --provider with no name', () => {
	expect(() => parse('models', '--limit', '3')).toThrow(usageError);
	expect(() => parse('models', '--provider', ',')).toThrow('--provider');
});

test('models --help prints its help beside a flag that would not parse', () => {
	expect(parse('models', '--limit', '--help')).toEqual({ command: 'help', topic: 'models' });
});
