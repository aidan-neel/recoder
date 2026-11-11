import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LENSES } from '../../../src/review/pipeline/lenses/lenses';
import { CliError, EXIT } from '../../../src/cli/exit';
import { parseReviewArgs } from '../../../src/cli/args/review-args';
import type { ReviewTarget } from '../../../src/cli/review/options';

const CWD = '/work/project';

const LENS_IDS = LENSES.map((lens) => lens.id);

const parse = (...argv: string[]) => parseReviewArgs(argv, CWD, 'program').options;

function usageMessage(...argv: string[]): string {
	try {
		parse(...argv);
	} catch (error) {
		if (error instanceof CliError && error.exitCode === EXIT.usage) return error.message;

		throw error;
	}

	throw new Error(`expected a usage error for ${argv.join(' ')}`);
}

/** The folders the running test made with `folderWith`, removed once it ends. */
const madeFolders: string[] = [];

afterEach(() => {
	for (const folder of madeFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A folder holding one file, for the flags that read a file. */
function folderWith(name: string, text: string): string {
	const directory = mkdtempSync(join(tmpdir(), 'recoder-args-'));

	madeFolders.push(directory);
	writeFileSync(join(directory, name), text);

	return directory;
}

describe('with no flags', () => {
	test('it reviews the range from the default branch to HEAD of the working directory', () => {
		const options = parse();

		expect(options.repoPath).toBe(CWD);
		expect(options.target).toEqual({ kind: 'range', base: null, head: 'HEAD' });
	});

	test('it takes the low budget, runs code, uses the baseline cache and leaves the saved settings alone', () => {
		const { tuning } = parse();

		expect(tuning).toMatchObject({
			budget: 'low',
			exec: true,
			baselineCache: true,
			lenses: null,
			reportLowSeverity: null
		});
	});

	test('for a program it writes JSON to standard output with text progress and never fails on findings', () => {
		expect(parse().output).toEqual({
			audience: 'program',
			format: 'json',
			file: null,
			progress: 'text',
			minSeverity: 'info',
			includeUnconfirmed: false,
			failOn: 'never'
		});
	});

	test('for a person it writes a report laid out for the terminal, with live progress', () => {
		expect(parseReviewArgs([], CWD, 'person').options.output).toMatchObject({ format: 'text', progress: 'live' });
	});
});

const TARGETS: [string[], ReviewTarget][] = [
	[['--base', 'main', '--head', 'topic'], { kind: 'range', base: 'main', head: 'topic' }],
	[['--staged'], { kind: 'staged' }],
	[['--uncommitted'], { kind: 'uncommitted' }],
	[['--pull', '12'], { kind: 'pull', pull: '12' }],
	[['--diff', '-'], { kind: 'diff', source: '-' }]
];

test.each(TARGETS)('%j selects its target', (argv, target) => {
	expect(parse(...argv).target).toEqual(target);
});

const CONFLICTS: [string[], string][] = [
	[['--staged', '--uncommitted'], '--staged and --uncommitted'],
	[['--pull', '1', '--diff', 'x.patch'], '--pull and --diff'],
	[['--staged', '--base', 'main'], '--base'],
	[['--pull', '1', '--head', 'topic'], '--pull'],
	[['--body', 'a', '--body-file', 'b'], '--body and --body-file'],
	[['--instructions', 'a', '--instructions-file', 'b'], '--instructions and --instructions-file'],
	[['--lens', 'security', '--skip-lens', 'rules'], '--lens and --skip-lens'],
	[['--low-severity', '--no-low-severity'], '--low-severity and --no-low-severity']
];

test.each(CONFLICTS)('%j is a usage error naming %s', (argv, named) => {
	expect(usageMessage(...argv)).toContain(named);
});

test('--reviewer, --worker and their efforts set the model picks of the review', () => {
	const { tuning } = parse(
		'--reviewer',
		'claude-code:opus',
		'--worker=devin:swe',
		'--reviewer-effort',
		'high',
		'--worker-effort=low'
	);

	expect(tuning).toMatchObject({
		reviewerModel: 'claude-code:opus',
		workerModel: 'devin:swe',
		reviewerEffort: 'high',
		workerEffort: 'low'
	});
});

test('a blank --reviewer is a usage error rather than the saved model', () => {
	expect(usageMessage('--reviewer=')).toContain('--reviewer');
});

describe('lists', () => {
	test('repeated and comma-separated lenses merge and drop duplicates', () => {
		expect(parse('--lens', 'security,correctness', '--lens', 'security').tuning.lenses).toEqual([
			'security',
			'correctness'
		]);
	});

	test('repeated and comma-separated levers merge and drop duplicates', () => {
		expect(parse('--enable', 'residual,obligations', '--enable', 'residual').tuning.levers).toEqual([
			'residual',
			'obligations'
		]);
	});

	test('--skip-lens runs every other lens', () => {
		expect(parse('--skip-lens', 'rules,readability').tuning.lenses).toEqual(
			LENS_IDS.filter((id) => id !== 'rules' && id !== 'readability')
		);
	});

	test('--skip-lens that removes every lens is a usage error', () => {
		expect(usageMessage('--skip-lens', LENS_IDS.join(','))).toContain('every lens');
	});
});

const REJECTED_CHOICES: [string[], string][] = [
	[['--lens', 'speed'], 'correctness'],
	[['--enable', 'magic'], 'contract-checks'],
	[['--budget', 'huge'], 'low, medium or high'],
	[['--reviewer-effort', 'extreme'], 'xhigh'],
	[['--min-severity', 'fatal'], 'info, warning or error'],
	[['--fail-on', 'fatal'], 'never, info, warning or error']
];

test.each(REJECTED_CHOICES)('%j is rejected and the message lists the allowed values, such as %s', (argv, allowed) => {
	expect(usageMessage(...argv)).toContain(allowed);
});

describe('--subagents', () => {
	test.each<[string, number | 'uncapped']>([
		['0', 0],
		['5', 5],
		['uncapped', 'uncapped']
	])('takes %s', (value, subagents) => {
		expect(parse('--subagents', value).tuning.subagents).toBe(subagents);
	});

	test('refuses a negative value', () => {
		expect(usageMessage('--subagents=-1')).toContain('--subagents');
	});

	test('refuses a fractional value and quotes it', () => {
		expect(usageMessage('--subagents', '1.5')).toContain('"1.5"');
	});
});

describe('--max-file-chars', () => {
	test('takes the largest value it allows', () => {
		expect(parse('--max-file-chars', '200000').tuning.maxFileChars).toBe(200000);
	});

	test('refuses zero', () => {
		expect(usageMessage('--max-file-chars', '0')).toContain('--max-file-chars');
	});

	test('refuses a value above the largest and quotes it', () => {
		expect(usageMessage('--max-file-chars', '200001')).toContain('200001');
	});
});

describe('--timeout', () => {
	test.each([
		['2', 120_000],
		['0.5', 30_000]
	])('turns %s minutes into milliseconds', (minutes, milliseconds) => {
		expect(parse('--timeout', minutes).timeoutMs).toBe(milliseconds);
	});

	test('refuses zero', () => {
		expect(usageMessage('--timeout', '0')).toContain('--timeout');
	});

	test('accepts the longest delay the runtime can wait for', () => {
		const longest = Math.floor(Number.MAX_SAFE_INTEGER / 60_000);

		expect(() => AbortSignal.timeout(parse('--timeout', String(longest)).timeoutMs ?? 0)).not.toThrow();
	});

	test('refuses a delay above the longest and names the maximum', () => {
		const longest = Math.floor(Number.MAX_SAFE_INTEGER / 60_000);

		expect(usageMessage('--timeout', String(longest + 1))).toContain(String(longest));
	});

	test('refuses a number too large to be finite', () => {
		expect(usageMessage('--timeout', '9'.repeat(309))).toContain('--timeout');
	});
});

describe('paths', () => {
	test('--repo becomes absolute against the working directory', () => {
		expect(parse('--repo', '../other').repoPath).toBe('/work/other');
	});

	test('--output becomes absolute against the working directory', () => {
		expect(parse('--output', 'out/review.json').output.file).toBe('/work/project/out/review.json');
	});
});

describe('switches', () => {
	test('--low-severity keeps low-severity findings', () => {
		expect(parse('--low-severity').tuning.reportLowSeverity).toBe(true);
	});

	test('--no-low-severity drops them', () => {
		expect(parse('--no-low-severity').tuning.reportLowSeverity).toBe(false);
	});

	test('--no-exec turns code execution off', () => {
		expect(parse('--no-exec').tuning.exec).toBe(false);
	});
});

describe('files', () => {
	test('--body-file is read', () => {
		const directory = folderWith('body.md', 'Adds retries.');

		expect(parseReviewArgs(['--body-file', 'body.md'], directory, 'program').options.intent.body).toBe('Adds retries.');
	});

	test('--instructions-file is read', () => {
		const directory = folderWith('rules.md', 'Ignore generated files.');

		expect(parseReviewArgs(['--instructions-file', 'rules.md'], directory, 'program').options.intent.instructions).toBe(
			'Ignore generated files.'
		);
	});

	test('a missing file is a usage error naming its path', () => {
		expect(usageMessage('--body-file', 'missing.md')).toContain('/work/project/missing.md');
	});
});

describe('intent text', () => {
	test('a title is trimmed', () => {
		expect(parse('--title', '  Add retries \n').intent.title).toBe('Add retries');
	});

	test.each(['title', 'body', 'instructions'])('a blank --%s is not given', (name) => {
		expect(parse(`--${name}`, ' \t\n').intent).toMatchObject({ [name]: null });
	});

	test.each([
		['body-file', 'body'],
		['instructions-file', 'instructions']
	])('a --%s that holds only white space leaves the %s not given', (flag, name) => {
		const directory = folderWith('blank.md', ' \n\t\n');

		expect(parseReviewArgs([`--${flag}`, 'blank.md'], directory, 'program').options.intent).toMatchObject({
			[name]: null
		});
	});
});

describe('bad arguments', () => {
	test('an unknown flag is a usage error naming it', () => {
		expect(usageMessage('--nope')).toContain('--nope');
	});

	test('a stray argument is a usage error naming it', () => {
		expect(usageMessage('extra')).toContain('extra');
	});

	test('a flag with no value is a usage error naming it', () => {
		expect(usageMessage('--budget')).toContain('--budget');
	});

	test.each([
		['--base', ''],
		['--include', ' ']
	])('an empty value for %s is a usage error naming the flag', (flag, value) => {
		expect(usageMessage(flag, value)).toContain(flag);
	});
});
