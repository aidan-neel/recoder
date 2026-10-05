import { z } from 'zod';
import { extractJsonValue } from '../models/json-extract';
import type { LabeledDefect, PrScore } from './benchmark-score';
import type { EvalFinding } from './metrics';

/** Sends one prompt to the judge model and returns its reply. */
export type JudgeChat = (system: string, user: string) => Promise<string>;

const SYSTEM = `You grade a code review against a list of known defects planted in a pull request.

For each defect, decide which review finding, if any, reports that same defect: the same root cause and the same consequence. A finding may point at the cause or at a place the defect shows up (a caller, a use site); location alone is not enough, and neither is a finding about a different problem on the same lines. A style or naming finding does not report a bug.

Pick at most one finding per defect, the one that describes it best, and list any other findings that report the same defect again as duplicates. Use null when no finding reports the defect.

Reply with JSON only:
{"matches":[{"defect":"<id>","finding":<index or null>,"duplicates":[<index>...],"reason":"<one sentence>"}]}`;

/** Bumped whenever the prompt or the scoring changes, so cached verdicts from the old judge are not reused. */
export const JUDGE_VERSION = 1;

const verdictSchema = z.object({
	matches: z.array(
		z.object({
			defect: z.string(),
			finding: z.number().int().nullable(),
			duplicates: z.array(z.number().int()).default([]),
			reason: z.string().default('')
		})
	)
});

function location(file: string, line?: number | null, endLine?: number | null): string {
	if (!line) return file;

	return endLine && endLine !== line ? `${file}:${line}-${endLine}` : `${file}:${line}`;
}

function judgePrompt(defects: readonly LabeledDefect[], findings: readonly EvalFinding[]): string {
	const defectList = defects.map((defect) => ({
		id: defect.id,
		at: location(defect.file, defect.line, defect.endLine),
		title: defect.title,
		description: defect.description,
		fix: defect.fix
	}));

	const findingList = findings.map((finding, index) => ({
		index,
		at: location(finding.file, finding.line, finding.endLine),
		title: finding.title,
		message: finding.message
	}));

	return `Defects:\n${JSON.stringify(defectList, null, 1)}\n\nReview findings:\n${JSON.stringify(findingList, null, 1)}`;
}

/**
 * Turns the judge's reply into a one-to-one score. A finding the judge gives
 * to two defects counts for the first; out-of-range indices and unknown
 * defect ids are ignored, so a sloppy reply can only lose credit, not invent it.
 */
export function scoreVerdicts(raw: unknown, defects: readonly LabeledDefect[], findingCount: number): PrScore {
	const { matches } = verdictSchema.parse(raw);
	const valid = (index: number | null): index is number => index !== null && index >= 0 && index < findingCount;
	const found: Record<string, number> = {};
	const reasons: Record<string, string> = {};
	const claimed = new Set<number>();
	const repeated = new Set<number>();

	for (const defect of defects) {
		const match = matches.find((item) => item.defect === defect.id);

		if (!match) continue;

		reasons[defect.id] = match.reason;

		if (valid(match.finding) && !claimed.has(match.finding)) {
			found[defect.id] = match.finding;
			claimed.add(match.finding);
		}

		for (const index of match.duplicates.filter(valid)) repeated.add(index);
	}

	const rest = Array.from({ length: findingCount }, (_, index) => index).filter((index) => !claimed.has(index));

	return {
		found,
		reasons,
		missed: defects.filter((defect) => !(defect.id in found)).map((defect) => defect.id),
		duplicates: rest.filter((index) => repeated.has(index)),
		unlabeled: rest.filter((index) => !repeated.has(index))
	};
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
