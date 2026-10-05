import { chatCompletion } from '../models/llm';
import type { Finding, ReasoningEffort } from '@recoder/shared';
import { configForModel, configForOrchestrator, configForSubagent } from '../models/models';
import type { CandidateOutcome } from '../review/pipeline/candidate-outcome';
import { initReviewSettings } from '../review/session/review-settings';
import { readCache, writeCache } from '../util/json-cache';
import { JUDGE_VERSION, judgePr, type JudgeChat } from './benchmark-judge';
import type { BenchmarkReport, JudgeModel, ScoredRun } from './benchmark-report';
import { lowsOfRun } from './benchmark-lows';
import type { LabeledDefect, PrScore } from './benchmark-score';
import { judgeStages, type PoolCandidate } from './benchmark-stages';
import { getCandidates } from './client';
import type { EvalFinding } from './metrics';
import type { RunRecord } from './report';
import { toEvalFinding } from './run-review';

/** The judge model's chat, and the model it names for the report and the verdict cache. */
export interface Judge {
	chat: JudgeChat;
	model: JudgeModel;
}

/** What scoring reads of a labeled PR. */
export interface ScoredLabel {
	id: string;
	defects: LabeledDefect[];
}

/** A fixed seed so a rerun of the judge on the same findings agrees with itself. */
const JUDGE_SEED = 7;
const JUDGE_TIMEOUT_MS = 5 * 60_000;

/**
 * The judge as a chat function, plus the model it names for the report. Only
 * the connection fields go to the call; the config itself, which holds the
 * API key, is never logged or written.
 */
export function judgeModel(choice: string, effort: ReasoningEffort | undefined): Judge {
	initReviewSettings();

	const config =
		choice === 'review'
			? configForOrchestrator()
			: choice === 'second'
				? configForSubagent()
				: configForModel(choice, effort);

	const chat: JudgeChat = (system, user) =>
		chatCompletion({
			provider: config.provider,
			baseUrl: config.baseUrl,
			apiKey: config.apiKey,
			model: config.model,
			reasoningEffort: config.reasoningEffort,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user }
			],
			jsonMode: true,
			temperature: 0,
			seed: JUDGE_SEED,
			timeoutMs: JUDGE_TIMEOUT_MS
		});

	return {
		chat,
		model: {
			model: config.model,
			provider: config.provider ?? 'openai-compatible',
			effort: config.reasoningEffort ?? null
		}
	};
}

/**
 * The judge's score for these findings, reused when the same model already
 * judged the same findings against the same defects, so a rerun that finds
 * the same things costs no judge call.
 */
async function cachedJudgement(
	judge: Judge,
	defects: readonly LabeledDefect[],
	findings: readonly EvalFinding[]
): Promise<PrScore> {
	const key = JSON.stringify([JUDGE_VERSION, judge.model, defects, findings]);
	const cached = readCache<PrScore>('benchmark-judge', key);

	if (cached) return cached;

	const score = await judgePr(judge.chat, defects, findings);

	writeCache('benchmark-judge', key, score);

	return score;
}

/** A review's candidates as the eval keeps them. */
function candidatePool(candidates: readonly (Finding & CandidateOutcome)[]): PoolCandidate[] {
	return candidates.map((candidate) => ({
		...toEvalFinding(candidate),
		stage: candidate.stage,
		reason: candidate.reason,
		verified: candidate.verified
	}));
}

/**
 * How far each planted defect got, judged over the run's candidates, and how
 * the judge scored the shown findings that were below the reporting bar. A
 * judge failure here leaves the stages out and keeps the run's score.
 */
async function scoreStages(judge: Judge, label: ScoredLabel, run: RunRecord, score: PrScore, base: string) {
	const candidates = await getCandidates(base, run.reviewId);

	if (!candidates) return {};

	const pool = candidatePool(candidates);
	const lows = run.findingIds ? { lows: lowsOfRun(run.findingIds, candidates, score) } : {};

	try {
		const stages = await judgeStages(label.defects, pool, score, (findings) =>
			cachedJudgement(judge, label.defects, findings)
		);

		return { pool, stages, ...lows };
	} catch (error) {
		console.error(`${label.id} stage judge failed: ${error instanceof Error ? error.message : String(error)}`);

		return { pool, ...lows };
	}
}

/** Judges a passed run; a judge failure leaves the run unscored instead of sinking the benchmark. */
export async function scoreRun(judge: Judge, label: ScoredLabel, run: RunRecord, base: string): Promise<ScoredRun> {
	if (run.outcome !== 'passed') return { ...run, score: null };

	try {
		const [score, hiddenScore] = await Promise.all([
			cachedJudgement(judge, label.defects, run.findings),
			run.unconfirmed ? cachedJudgement(judge, label.defects, run.unconfirmed) : null
		]);

		return { ...run, score, hiddenScore, ...(await scoreStages(judge, label, run, score, base)) };
	} catch (error) {
		const judgeError = error instanceof Error ? error.message : String(error);

		console.error(`${label.id} judge failed: ${judgeError}`);

		return { ...run, score: null, judgeError };
	}
}

/** The run as the review recorded it, without anything a score added. */
function unscored(run: ScoredRun): RunRecord {
	const { score: _score, hiddenScore: _hidden, pool: _pool, stages: _stages, lows: _lows, ...rest } = run;
	const { labeled: _labeled, judgeError: _error, ...stored } = rest;

	return stored;
}

/**
 * Every run of a saved report scored again from its stored findings, placed
 * by run number. It starts no review: the judge is called only for findings
 * it has not scored before, and the candidates are read from the server.
 */
export async function rescoredRecords(
	report: BenchmarkReport,
	labels: readonly ScoredLabel[],
	judge: Judge,
	base: string
): Promise<ScoredRun[][]> {
	return Promise.all(
		labels.map(async (label) => {
			const records: ScoredRun[] = [];

			for (const run of report.prs.find((pr) => pr.id === label.id)?.runs ?? []) {
				const stored = unscored(run);

				records[run.index - 1] = await scoreRun(judge, label, stored, base);
			}

			return records;
		})
	);
}
