import { beforeEach, describe, expect, test } from 'bun:test';
import { restoreEnvAfterEach } from '../../../helpers/env';
import { deriveFrom, file, hits, triggers } from './fixtures';

restoreEnvAfterEach(['RECODER_OBLIGATIONS_TRANSITIONS']);

beforeEach(() => {
	process.env.RECODER_OBLIGATIONS_TRANSITIONS = '1';
});

/** A job lifecycle: queued in an initial record, guarded on running, started on line 7. */
const JOB = [
	"export const INITIAL = { status: 'queued' };",
	'',
	'export function finish(job: { status: string }, ok: boolean) {',
	"\tif (job.status !== 'running') return;",
	"\tjob.status = ok ? 'done' : 'failed';",
	'}',
	'export function start(job: { status: string }) {',
	"\tjob.status = 'running';",
	'}'
];

/** `JOB` with line `line` (1-based) replaced by `text`. */
function jobWith(line: number, text: string): string[] {
	return JOB.map((entry, index) => (index === line - 1 ? text : entry));
}

describe('state fields', () => {
	test('a state field set to a different state derives the obligation', async () => {
		const found = await hits(file('src/job.ts', JOB, jobWith(8, "\tjob.status = 'started';")));

		expect(found).toContain('state-transition new:8');
	});

	test('a changed guard on a state derives it', async () => {
		const found = await hits(file('src/job.ts', JOB, jobWith(4, "\tif (job.status !== 'queued') return;")));

		expect(found).toContain('state-transition new:4');
	});

	test('a state move kept through a reformat derives nothing', async () => {
		const found = await hits(file('src/job.ts', JOB, jobWith(8, "\tjob.status =   'running' ;")));

		expect(triggers(found)).not.toContain('state-transition');
	});

	test('a field the file gives only one state derives nothing', async () => {
		const found = await hits(
			file(
				'src/health.ts',
				["export const health = () => ({ status: 'ok' });"],
				["export const health = () => ({ status: 'fine' });"]
			)
		);

		expect(triggers(found)).not.toContain('state-transition');
	});

	test('a numeric status, such as an HTTP code, derives nothing', async () => {
		const found = await hits(
			file(
				'src/reply.ts',
				['export function fail(res: { status: number }) {', '\tres.status = 500;', '}'],
				['export function fail(res: { status: number }) {', '\tres.status = 404;', '}']
			)
		);

		expect(triggers(found)).not.toContain('state-transition');
	});

	test("the obligation's first hint names the states the file gives the field", async () => {
		const change = file('src/job.ts', JOB, jobWith(8, "\tjob.status = 'started';"));

		const derived = await deriveFrom(change.base, change.head);
		const hint = derived.find((entry) => entry.trigger === 'state-transition')?.contractHints[0] ?? '';

		expect(hint).toContain("'queued'");
		expect(hint).toContain("'started'");
	});
});

describe('leases, flags, caches and queues', () => {
	const save = [
		'export function save(cache: Map<string, string>, key: string, value: string) {',
		'\twrite(key, value);',
		'\tcache.delete(key);',
		'}',
		'',
		'function write(key: string, value: string) {',
		'\treturn key + value;',
		'}'
	];

	test('a removed cache invalidation derives the obligation on the old side', async () => {
		const found = await hits(file('src/save.ts', save, [save[0], save[1], ...save.slice(3)]));

		expect(found).toContain('state-transition old:3');
	});

	test('a lease written on an entity derives it', async () => {
		const before = ['export function claim(job: { leaseUntil: number }, ttl: number) {', '\treturn ttl;', '}'];

		const found = await hits(
			file('src/lease.ts', before, [before[0], '\tjob.leaseUntil = Date.now() + ttl;', '\treturn ttl;', '}'])
		);

		expect(found).toContain('state-transition new:2');
	});

	test('an entry pushed onto a queue derives it in source and nothing in a test', async () => {
		const before = ['export function submit(jobQueue: string[], job: string) {', '\treturn job;', '}'];
		const after = [before[0], '\tjobQueue.push(job);', '\treturn job;', '}'];

		const source = await hits(file('src/submit.ts', before, after));
		const tested = await hits(file('src/submit.test.ts', before, after));

		expect(source).toContain('state-transition new:2');
		expect(triggers(tested)).not.toContain('state-transition');
	});

	test('a push onto a list that is not a queue derives nothing', async () => {
		const before = ['export function collect(names: string[], name: string) {', '\treturn name;', '}'];

		const found = await hits(file('src/collect.ts', before, [before[0], '\tnames.push(name);', '\treturn name;', '}']));

		expect(triggers(found)).not.toContain('state-transition');
	});
});

test('with the transitions flag off, a state move derives nothing', async () => {
	delete process.env.RECODER_OBLIGATIONS_TRANSITIONS;

	const found = await hits(file('src/job.ts', JOB, jobWith(8, "\tjob.status = 'started';")));

	expect(triggers(found)).not.toContain('state-transition');
});
