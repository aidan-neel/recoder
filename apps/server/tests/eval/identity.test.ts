import { expect, test } from 'bun:test';
import {
	allowDiffFields,
	checkCompatibility,
	compatibilityLines,
	mergeProblems,
	type RunIdentity
} from '../../src/eval/identity';
import { identityFields, recordedIdentity } from '../helpers/identity';

/** The fields two identities disagree on, as a comparison refuses them. */
function compareIdentity(a: RunIdentity, b: RunIdentity) {
	return checkCompatibility({ name: 'A', identity: a }, { name: 'B', identity: b }, 'compare', []).refused;
}

/** The fixture identity with one change applied to a fresh copy of its fields. */
function changed(change: (fields: ReturnType<typeof identityFields>) => void) {
	const fields = identityFields();

	change(fields);

	return recordedIdentity(fields);
}

test('identical identities compare equal and share a hash', () => {
	const a = recordedIdentity(identityFields());
	const b = recordedIdentity(identityFields());

	expect(a.hash).toBe(b.hash);
	expect(compareIdentity(a, b)).toEqual([]);

	expect(checkCompatibility({ name: 'A', identity: a }, { name: 'B', identity: b }, 'compare', [])).toMatchObject({
		compatible: true,
		refused: [],
		unrecorded: []
	});
});

test('a changed label file, flag or model changes the hash and is named', () => {
	const base = recordedIdentity(identityFields());

	const labels = changed((fields) => {
		fields.dataset.labels = 'labels-2';
	});

	const flag = changed((fields) => {
		fields.flags = { ...(fields.flags as Record<string, string>), RECODER_TEST_STRENGTH: '1' };
	});

	const model = changed((fields) => {
		fields.models.specialist.model = 'gpt-y';
	});

	for (const other of [labels, flag, model]) expect(other.hash).not.toBe(base.hash);

	expect(compareIdentity(base, labels)).toEqual([{ field: 'dataset.labels', a: 'labels-1', b: 'labels-2' }]);
	expect(compareIdentity(base, flag)).toEqual([{ field: 'flags.RECODER_TEST_STRENGTH', a: 'unset', b: '1' }]);
	expect(compareIdentity(base, model)).toEqual([{ field: 'models.specialist.model', a: 'gpt-x', b: 'gpt-y' }]);
});

test('where and how a report ran is recorded but leaves the hash alone and never refuses', () => {
	const base = recordedIdentity(identityFields());

	const mac = changed((fields) => {
		fields.host = { ...fields.host, name: 'mini', arch: 'arm64', cpus: 10 };
		fields.execution.concurrency = 1;
	});

	const result = checkCompatibility({ name: 'pc', identity: base }, { name: 'mini', identity: mac }, 'resume', []);

	expect(mac.hash).toBe(base.hash);
	expect(result.compatible).toBe(true);

	expect(result.informational.map((diff) => diff.field)).toEqual([
		'execution.concurrency',
		'host.arch',
		'host.cpus',
		'host.name'
	]);
});

test('an undeclared difference refuses with the field named; declared, it passes and is listed', () => {
	const off = { name: 'off', identity: recordedIdentity(identityFields()) };

	const on = {
		name: 'on',
		identity: changed((fields) => {
			fields.flags = { ...(fields.flags as Record<string, string>), RECODER_TEST_STRENGTH: '1' };
		})
	};

	const refused = checkCompatibility(off, on, 'resume', []);

	expect(refused.compatible).toBe(false);
	expect(compatibilityLines(refused)).toEqual(['Incompatible:', '  flags.RECODER_TEST_STRENGTH: unset → 1']);

	const declared = checkCompatibility(off, on, 'resume', ['flags.RECODER_TEST_STRENGTH']);

	expect(declared.compatible).toBe(true);
	expect(declared.declared).toEqual([{ field: 'flags.RECODER_TEST_STRENGTH', a: 'unset', b: '1' }]);
	expect(compatibilityLines(declared)).toEqual(['Declared differences:', '  flags.RECODER_TEST_STRENGTH: unset → 1']);
});

test('a replay expects new code, labels and adjudications, but a new reviewer model must be declared', () => {
	const origin = { name: 'origin', identity: recordedIdentity(identityFields()) };

	const now = {
		name: 'now',
		identity: changed((fields) => {
			fields.code.server = 'server-2';
			fields.dataset.labels = 'labels-2';
			fields.dataset.adjudications = 'adjudications-2';
			fields.models.orchestrator = { ...fields.models.orchestrator, effort: 'low' };
		})
	};

	const result = checkCompatibility(origin, now, 'replay', []);

	expect(result.exempt.map((diff) => diff.field)).toEqual(['code.server', 'dataset.adjudications', 'dataset.labels']);
	expect(result.refused.map((diff) => diff.field)).toEqual(['models.orchestrator.effort']);

	expect(checkCompatibility(origin, now, 'resume', ['code']).refused.map((diff) => diff.field)).toEqual([
		'dataset.labels',
		'models.orchestrator.effort'
	]);
});

test('a field unknown on both sides is unverifiable: resume, replay, compare and merge refuse it unless declared', () => {
	const blind = (name: string) => ({
		name,
		identity: changed((fields) => {
			fields.flags = 'unknown';
		}),
		runIds: [`${name}#1`]
	});

	const a = blind('A');
	const b = blind('B');

	expect(a.identity.hash).toBe(b.identity.hash);

	for (const operation of ['resume', 'replay', 'compare', 'merge'] as const) {
		const result = checkCompatibility(a, b, operation, []);

		expect(result.compatible).toBe(false);
		expect(result.unverifiable).toEqual([{ field: 'flags', a: 'unknown', b: 'unknown' }]);
	}

	expect(compatibilityLines(checkCompatibility(a, b, 'compare', []))).toEqual([
		'Unverifiable:',
		'  flags: unknown → unknown'
	]);

	expect(mergeProblems([a, b])).toEqual(['B cannot be checked against A in flags: unknown → unknown']);
	expect(checkCompatibility(a, b, 'resume', ['flags']).compatible).toBe(true);

	const oneSided = changed((fields) => {
		fields.code.server = 'unknown';
	});

	expect(
		checkCompatibility(
			{ name: 'A', identity: recordedIdentity(identityFields()) },
			{ name: 'B', identity: oneSided },
			'resume',
			[]
		).unverifiable
	).toEqual([{ field: 'code.server', a: 'server-1', b: 'unknown' }]);
});

test('a report without an identity is flagged and claims no equivalence unless declared', () => {
	const old = { name: 'old.json' };
	const now = { name: 'this run', identity: recordedIdentity(identityFields()) };
	const result = checkCompatibility(old, now, 'resume', []);

	expect(result.unrecorded).toEqual(['old.json']);
	expect(result.compatible).toBe(false);
	expect(compatibilityLines(result)).toEqual(['Identity not recorded in old.json; no equivalence can be claimed.']);
	expect(checkCompatibility(old, now, 'resume', ['identity']).compatible).toBe(true);
});

test('shards of one experiment merge; a missing identity, a differing flag, a split head or a repeated run fail', () => {
	const shard = (name: string, task: string, runIds: string[], change?: Parameters<typeof changed>[0]) => ({
		name,
		identity: changed((fields) => {
			fields.tasks = [{ taskId: task, base: 'base-1' }];
			change?.(fields);
		}),
		runIds
	});

	const a = shard('A', 'pr-1@aaa', ['pr-1@aaa#1']);
	const b = shard('B', 'pr-2@bbb', ['pr-2@bbb#1']);

	expect(mergeProblems([a, b])).toEqual([]);
	expect(mergeProblems([a, { name: 'old', runIds: [] }])).toEqual(['identity not recorded in old']);

	expect(
		mergeProblems([
			a,
			shard('B', 'pr-2@bbb', ['pr-2@bbb#1'], (fields) => {
				fields.flags = { ...(fields.flags as Record<string, string>), RECODER_OBLIGATIONS: 'on' };
			})
		])
	).toEqual(['B differs from A in flags.RECODER_OBLIGATIONS: unset → on']);

	expect(mergeProblems([a, shard('B', 'pr-1@ccc', ['pr-1@ccc#1'])])).toEqual([
		'one PR at two heads: pr-1@aaa vs pr-1@ccc'
	]);

	expect(mergeProblems([a, shard('B', 'pr-1@aaa', ['pr-1@aaa#1'])])).toEqual([
		'run ids listed more than once (1): pr-1@aaa#1; a run counted twice would sum its defects as new ones'
	]);
});

test('repeats of one experiment merge by report id; a replay keeps its report id, so its runs collide', () => {
	const report = (name: string, reportId: string) => ({
		name,
		reportId,
		identity: recordedIdentity(),
		runIds: ['pr-1@aaa#1']
	});

	expect(mergeProblems([report('A', 'r1'), report('B', 'r2'), report('C', 'r3')])).toEqual([]);

	expect(mergeProblems([report('A', 'r1'), report('A replayed', 'r1')])).toEqual([
		'run ids listed more than once (1): pr-1@aaa#1; a run counted twice would sum its defects as new ones'
	]);
});

test('--allow-diff takes a comma list of identity fields and rejects names an identity lacks', () => {
	expect(allowDiffFields(' flags.RECODER_TEST_STRENGTH, identity ,')).toEqual({
		fields: ['flags.RECODER_TEST_STRENGTH', 'identity'],
		error: null
	});

	expect(allowDiffFields(undefined)).toEqual({ fields: [], error: null });
	expect(allowDiffFields('flag.RECODER_TEST_STRENGTH').error).toContain('does not know flag.RECODER_TEST_STRENGTH');
});
