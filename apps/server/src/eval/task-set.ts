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
}

/** The task set of a benchmark that reviews every labeled PR. */
const FULL_SET = 'full';

/** The task set of a benchmark narrowed with `--only`. */
const ONLY_SET = 'only';

/** A set name is also its file name, so it cannot leave `sets/`, and it cannot pass for `full` or `only`. */
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

/** Every label file in the dataset, by id with numbers in order. */
export function readLabels(dataset: string): PrLabel[] {
	const dir = join(dataset, 'labels');

	const labels = readdirSync(dir)
		.filter((name) => name.endsWith('.json'))
		.map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as PrLabel)
		.sort((a, b) => byId(a.id, b.id));

	if (!labels.length) throw new Error(`No labeled PRs in ${dir}.`);

	return labels;
}

/** Orders ids with their numbers as numbers, so `hono-2` comes before `hono-10`. */
export function byId(a: string, b: string): number {
	return a.localeCompare(b, 'en', { numeric: true });
}

/** `<dataset>/sets/<name>.json`, refusing a name that is no set name. */
export function taskSetPath(dataset: string, name: string): string {
	if (!SET_NAME.test(name) || name === FULL_SET || name === ONLY_SET)
		throw new Error(
			`Task set name ${JSON.stringify(name)} is lowercase letters, digits and dashes, and not ${FULL_SET} or ${ONLY_SET}.`
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
 * (`full`), the `--only` ids (`only`), or a named set. A set or `--only` id
 * the dataset has no label for refuses the run, so a stale set never quietly
 * shrinks. Pure, so a sharded run can split the result.
 */
export function selectTasks<Label extends { id: string }>(
	labels: readonly Label[],
	choice: { only: readonly string[] | null; set: TaskSet | null }
): { name: string; labels: Label[] } {
	if (choice.only && choice.set) throw new Error('--only and --set each choose the tasks; pass one.');

	const ids = choice.set?.tasks ?? choice.only;

	if (!ids) return { name: FULL_SET, labels: [...labels] };

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
