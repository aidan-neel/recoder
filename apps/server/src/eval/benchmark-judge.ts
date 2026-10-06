import { z } from 'zod';
import { extractJsonValue } from '../models/json-extract';
import type { JudgeNote, LabeledDefect, PrScore } from './benchmark-score';
import { judgeInput, location } from './claim';
import type { EvalFinding } from './metrics';

/** Sends one prompt to the judge model and returns its reply. */
export type JudgeChat = (system: string, user: string) => Promise<string>;

const SYSTEM = `You grade a code review against a list of known defects planted in a pull request.

For each defect, decide which review finding, if any, reports that same defect: the same wrong behavior (what goes wrong, observably) and the same cause (the code fact that makes it go wrong). A finding may point at the cause or at a place the defect shows up (a caller, a use site); location alone is not enough, and neither is a finding about a different problem on the same lines. A style or naming finding does not report a bug.

For each defect, name the finding that comes closest, or null when no finding is about it at all. Say in a few words which behavior and which cause that finding describes, and whether each is the defect's. A finding reports the defect only when both are. List any other findings that report the same defect again, with the same behavior and cause, as duplicates.

Reply with JSON only:
{"matches":[{"defect":"<id>","finding":<index or null>,"behavior":"<the behavior the finding describes>","cause":"<the cause it names>","sameBehavior":<true or false>,"sameCause":<true or false>,"duplicates":[<index>...],"reason":"<one sentence>"}]}`;

/** Bumped whenever the prompt or the scoring changes, so cached verdicts from the old judge are not reused. */
export const JUDGE_VERSION = 2;

/** A verdict that leaves out whether the behavior or the cause is the defect's confirms neither, so it earns no credit. */
const verdictSchema = z.object({
	matches: z.array(
		z.object({
			defect: z.string(),
			finding: z.number().int().nullable(),
			behavior: z.string().default(''),
			cause: z.string().default(''),
			sameBehavior: z.boolean().default(false),
			sameCause: z.boolean().default(false),
			duplicates: z.array(z.number().int()).default([]),
			reason: z.string().default('')
		})
	)
});

function judgePrompt(defects: readonly LabeledDefect[], findings: readonly EvalFinding[]): string {
	const defectList = defects.map((defect) => ({
		id: defect.id,
		at: location(defect.file, defect.line, defect.endLine),
		title: defect.title,
		description: defect.description,
		fix: defect.fix
	}));

	const findingList = findings.map((finding, index) => ({ index, ...judgeInput(finding) }));

	return `Defects:\n${JSON.stringify(defectList, null, 1)}\n\nReview findings:\n${JSON.stringify(findingList, null, 1)}`;
}

/**
 * The missed defects, duplicates and unlabeled findings that follow from
 * which finding found each defect and which findings repeat it. A finding that
 * found a defect is never a duplicate.
 */
export function settle(
	score: Omit<PrScore, 'missed' | 'duplicates' | 'unlabeled'>,
	defects: readonly LabeledDefect[],
	findingCount: number
): PrScore {
	const claimed = new Set(Object.values(score.found));
	const repeated = new Set(Object.values(score.repeats ?? {}).flat());
	const rest = Array.from({ length: findingCount }, (_, index) => index).filter((index) => !claimed.has(index));

	return {
		...score,
		missed: defects.filter((defect) => !(defect.id in score.found)).map((defect) => defect.id),
		duplicates: rest.filter((index) => repeated.has(index)),
		unlabeled: rest.filter((index) => !repeated.has(index))
	};
}

/**
 * Turns the judge's reply into a one-to-one score. A finding counts for a
 * defect only when the judge says it has the defect's behavior and its cause;
 * otherwise it is kept as the claim the judge weighed and rejected. A finding
 * the judge gives to two defects counts for the first; out-of-range indices
 * and unknown defect ids are ignored, so a sloppy reply can only lose credit,
 * not invent it.
 */
export function scoreVerdicts(raw: unknown, defects: readonly LabeledDefect[], findingCount: number): PrScore {
	const { matches } = verdictSchema.parse(raw);
	const valid = (index: number | null): index is number => index !== null && index >= 0 && index < findingCount;
	const found: Record<string, number> = {};
	const reasons: Record<string, string> = {};
	const repeats: Record<string, number[]> = {};
	const notes: Record<string, JudgeNote> = {};
	const claimed = new Set<number>();

	for (const defect of defects) {
		const match = matches.find((item) => item.defect === defect.id);

		if (!match) continue;

		const finding = valid(match.finding) ? match.finding : null;
		const reports = match.sameBehavior && match.sameCause;

		reasons[defect.id] = match.reason;
		notes[defect.id] = { finding, behavior: match.behavior, cause: match.cause, reports };

		if (!reports) continue;

		if (finding !== null && !claimed.has(finding)) {
			found[defect.id] = finding;
			claimed.add(finding);
		}

		const again = match.duplicates.filter((index) => valid(index) && index !== finding);

		if (again.length) repeats[defect.id] = again;
	}

	return settle({ found, reasons, repeats, notes }, defects, findingCount);
}

/** Asks the judge which findings report which planted defects; with no defect to match it makes no call. */
export async function judgePr(
	chat: JudgeChat,
	defects: readonly LabeledDefect[],
	findings: readonly EvalFinding[]
): Promise<PrScore> {
	if (!findings.length || !defects.length) return scoreVerdicts({ matches: [] }, defects, findings.length);

	const reply = await chat(SYSTEM, judgePrompt(defects, findings));

	return scoreVerdicts(extractJsonValue(reply), defects, findings.length);
}
