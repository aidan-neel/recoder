import { expect, test } from 'bun:test';
import type { DoctorCheck } from '../../../src/cli/doctor/doctor';
import { machineStep } from '../../../src/cli/init/machine-step';

const check = (id: string, overrides: Partial<DoctorCheck> = {}): DoctorCheck => ({
	id,
	ok: true,
	required: true,
	detail: `${id} is fine.`,
	fix: null,
	...overrides
});

const NO_MODEL = check('review-model', { ok: false, detail: 'No review model is configured.', fix: 'Configure one.' });

const NO_GIT = check('git', { ok: false, detail: 'git is not on PATH.', fix: 'Install git.' });

test('a missing review model is not reported twice: the step before this one already said so', () => {
	const step = machineStep({ ok: false, checks: [check('git'), NO_MODEL] }, false);

	expect(step).toMatchObject({ state: 'unchanged', fix: null });
});

test('the first required check that failed is the step, with its fix', () => {
	const step = machineStep({ ok: false, checks: [NO_GIT, NO_MODEL] }, false);

	expect(step).toMatchObject({ state: 'failed', detail: 'git is not on PATH.', fix: 'Install git.' });
});

test('a chosen model that its agent does not offer is this step to report', () => {
	const step = machineStep({ ok: false, checks: [check('git'), NO_MODEL] }, true);

	expect(step).toMatchObject({ state: 'failed', fix: 'Configure one.' });
});

test('a failed optional check does not stop the machine being ready', () => {
	const sandbox = check('sandbox', { ok: false, required: false });

	expect(machineStep({ ok: true, checks: [sandbox] }, true)).toMatchObject({ state: 'unchanged' });
});
