import { expect, test } from 'bun:test';
import { parseInvocation } from '../../../src/cli/args/command';
import { EXIT } from '../../../src/cli/exit';
import { VERSION } from '../../../src/version';

const RUN_ID = '20261110-153045-a1b2c3';

const OTHER_RUN_ID = '20261110-153045-a1b2c4';

const parse = (...argv: string[]) => parseInvocation(argv, '/work');

const usageError = expect.objectContaining({ exitCode: EXIT.usage });

test('--help beside a flag that would not parse still prints help', () => {
	expect(parse('review', '--budget', 'huge', '--help').command).toBe('print');
});

test('--version prints the server version', () => {
	expect(parse('--version')).toEqual({ command: 'print', text: VERSION });
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

test('a run command with no run id is a usage error', () => {
	expect(() => parse('status')).toThrow(usageError);
});

test('a run command given two run ids names the second', () => {
	expect(() => parse('cancel', RUN_ID, OTHER_RUN_ID)).toThrow(OTHER_RUN_ID);
});

test('skill passes its arguments on untouched', () => {
	expect(parse('skill', 'install', '--force')).toEqual({ command: 'skill', argv: ['install', '--force'] });
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
	expect(parse('models', '--limit', '--help').command).toBe('print');
});
