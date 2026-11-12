import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { LabeledDefect } from './benchmark-score';

/** One synthetic PR's label file, as the dataset's assemble step writes it. */
export interface PrLabel {
	id: string;
	codebase: string;
	/** The local forge repo's `file://` URL. */
	repo: string;
	pull: number;
	headSha: string;
	verified: boolean;
	defects: LabeledDefect[];
	/**
	 * The label's codebase is held out: the `full` set and `eval:select-set`
	 * leave it out, and only `--set holdout`, `--only` or a hand-written set
	 * reviews it. Absent in label files older than the mark, which means not
	 * holdout; every label of a holdout codebase carries it.
	 */
	holdout?: boolean;
}

/** The task set of a benchmark that reviews every labeled PR not marked holdout. */
const FULL_SET = 'full';

/** The task set of a benchmark narrowed with `--only`. */
const ONLY_SET = 'only';

/** The task set of a benchmark over only the labels marked holdout, asked for with `--set holdout`. */
export const HOLDOUT_SET = 'holdout';

/** A set name is also its file name, so it cannot leave `sets/`, and it cannot pass for a built-in set. */
const SET_NAME = /^[a-z0-9][a-z0-9-]*$/;

const taskSetSchema = z.object({
	name: z.string().regex(SET_NAME),
	tasks: z.array(z.string().min(1)).min(1),
	/** The report file names the selection was made from. */
	sources: z.array(z.string()),
	selectedAt: z.string(),
	/** The selection rule, in one line. */
	rule: z.string()
});

/** A named, fixed list of labeled PRs, kept in the dataset's private `sets/` folder. */
export type TaskSet = z.infer<typeof taskSetSchema>;

/**
 * What `readLabels` checks of a label file: the mark the benchmark branches
 * on. The assemble step's own fields pass through unchecked, as before.
 */
const labelFileSchema = z.looseObject({
	holdout: z.boolean().optional()
});

/**
 * One label file, refusing a `holdout` that is not a boolean. The file's
 * other fields are the assemble step's own shape, trusted as the cast was
 * before this check existed.
 */
function readLabel(path: string): PrLabel {
	const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
	const checked = labelFileSchema.safeParse(raw);

	if (!checked.success)
		throw new Error(`${path}: invalid label file: ${checked.error.issues.map((issue) => issue.message).join('; ')}.`);

	return raw as PrLabel;
}

/** Every label file in the dataset, by id with numbers in order. */
export function readLabels(dataset: string): PrLabel[] {
	const dir = join(dataset, 'labels');

	const labels = readdirSync(dir)
		.filter((name) => name.endsWith('.json'))
		.map((name) => readLabel(join(dir, name)))
		.sort((a, b) => byId(a.id, b.id));

	if (!labels.length) throw new Error(`No labeled PRs in ${dir}.`);

	return labels;
}

/** Orders ids with their numbers as numbers, so `hono-2` comes before `hono-10`. */
export function byId(a: string, b: string): number {
	return a.localeCompare(b, 'en', { numeric: true });
}

/** `<dataset>/sets/<name>.json`, refusing a name that is no set name or a built-in set's. */
export function taskSetPath(dataset: string, name: string): string {
	if (!SET_NAME.test(name) || name === FULL_SET || name === ONLY_SET || name === HOLDOUT_SET)
		throw new Error(
			`Task set name ${JSON.stringify(name)} is lowercase letters, digits and dashes, and not ${FULL_SET}, ${ONLY_SET} or ${HOLDOUT_SET}.`
		);

	return join(dataset, 'sets', `${name}.json`);
}

/** The dataset's task set `name`, refusing a file whose own name differs. */
export function readTaskSet(dataset: string, name: string): TaskSet {
	const path = taskSetPath(dataset, name);
	const set = taskSetSchema.parse(JSON.parse(readFileSync(path, 'utf8')));

	if (set.name !== name) throw new Error(`${path} names the task set ${set.name}, not ${name}.`);

	return set;
}

/**
 * The labels a benchmark reviews and the name of their task set: every label
 * not marked holdout (`full`), only the holdout ones (`--set holdout`), the
 * `--only` ids (`only`), or a named set. A set or `--only` id the dataset has
 * no label for refuses the run, so a stale set never quietly shrinks. Pure, so
 * a sharded run can split the result.
 */
export function selectTasks<Label extends { id: string; holdout?: boolean }>(
	labels: readonly Label[],
	choice: { only: readonly string[] | null; set: TaskSet | typeof HOLDOUT_SET | null }
): { name: string; labels: Label[] } {
	if (choice.only && choice.set) throw new Error('--only and --set each choose the tasks; pass one.');

	if (choice.set === HOLDOUT_SET) {
		const held = labels.filter((label) => label.holdout);

		if (!held.length) throw new Error('Task set holdout: the dataset marks no label holdout.');

		return { name: HOLDOUT_SET, labels: held };
	}

	const ids = choice.set?.tasks ?? choice.only;

	if (!ids) {
		const development = labels.filter((label) => !label.holdout);

		if (!development.length)
			throw new Error('Every label is marked holdout; pass --set holdout or --only to choose tasks.');

		return { name: FULL_SET, labels: development };
	}

	const missing = ids.filter((id) => !labels.some((label) => label.id === id));

	if (missing.length)
		throw new Error(
			`${choice.set ? `Task set ${choice.set.name}` : '--only'} names PRs the dataset has no labels for: ${missing.join(', ')}.`
		);

	return { name: choice.set?.name ?? ONLY_SET, labels: labels.filter((label) => ids.includes(label.id)) };
}

/** The lines that mark a benchmark over a subset, so its totals are never read as the full set's; none for a report older than recording its set. */
export function subsetLines(taskSet: string | undefined): string[] {
	return !taskSet || taskSet === FULL_SET ? [] : [`Task set ${taskSet}: subset result, not a full-set score.`];
}
