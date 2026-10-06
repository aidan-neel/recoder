import type { CandidateOutcome, StopStage } from '../review/pipeline/candidate-outcome';
import type { LabeledDefect, PrScore } from './benchmark-score';
import { claimHash, claimRef, type ClaimRef } from './claim';
import type { EvalFinding } from './metrics';

/** A review candidate as the eval keeps it: the finding, its id (absent from older reports), and how far it got. */
export type PoolCandidate = EvalFinding & CandidateOutcome & { id?: string };

/** Where a defect's best candidate stopped; `consolidation` when it was verified and still no shown finding reported it. */
type StoppedAt = StopStage | 'consolidation';

/**
 * How a stage's call on a defect was made: by the judge over that stage's
 * claims, reused from the published finding whose claim is the same text, or
 * by a human correction in the adjudication file.
 */
type MatchedBy = 'judged' | 'reused' | 'adjudicated';

/** The evidence for one defect at one stage. */
export interface StageMatch {
	/** The claim credited with the defect at this stage; null when none is. */
	claim: ClaimRef | null;
	by: MatchedBy;
	reason: string;
	/** The behavior and the cause the judge read in the claim it weighed. */
	behavior: string;
	cause: string;
	/** A claim the judge or a human weighed for the defect and rejected: another behavior or cause, however near. */
	rejected?: ClaimRef;
}

/** What became of the claim a defect was lost with at consolidation. */
interface LostClaim {
	claim: ClaimRef;
	/**
	 * `changed`: merged into the published finding `into`, whose claim the
	 * judge does not credit; `disappeared`: no published finding carries it;
	 * `untraced`: the report records no candidate ids, so which is unknown.
	 */
	change: 'changed' | 'disappeared' | 'untraced';
	into?: string;
}

/** The stages a defect's evidence is kept for. */
type Stage = 'found' | 'verified' | 'published';

/** How far one planted defect got in one run. Each stage includes the one after it. */
export interface DefectStage {
	/** Some candidate, dropped or held back included, reports it. */
	found: boolean;
	/** A verified candidate reports it, or a shown finding does. */
	verified: boolean;
	/** A shown finding reports it. */
	published: boolean;
	/** For a defect found but not published, the stage that stopped its best candidate. */
	stoppedAt?: StoppedAt;
	reason?: string;
	/** The evidence behind each stage's call; absent from reports older than recording it. */
	matches?: Record<Stage, StageMatch>;
	/** For a defect lost at consolidation, the claim it was lost with and what became of it. */
	lost?: LostClaim;
}

/** The defects of every run that kept its candidates, counted by how far they got. */
export interface StageTotals {
	planted: number;
	found: number;
	verified: number;
	published: number;
	/** Defects found but not published, by the stage that stopped them. */
	stoppedAt: Record<string, number>;
}

/** A run's shown findings, their ids when the report recorded them, and the judge's score of them. */
export interface Published {
	findings: readonly EvalFinding[];
	ids?: readonly string[];
	score: PrScore;
}

/** The judge's score for a set of findings against the PR's defects. */
type Judged = (findings: readonly EvalFinding[]) => Promise<PrScore>;

/** The judge's scores of the candidates whose claim no shown finding has, all of them and the verified ones. */
interface ChangedScores {
	all: PrScore;
	verified: PrScore;
}

/** One judged list of claims: the judge's score, each entry's claim, and for candidates their place in the pool. */
interface Judgement {
	score: PrScore;
	refs: readonly ClaimRef[];
	at: readonly number[];
}

/** The findings that report a defect: the judge's match first, then the ones that repeat it. */
function reporters(score: PrScore, id: string): number[] {
	const first = score.found[id];

	return [...(first === undefined ? [] : [first]), ...(score.repeats?.[id] ?? [])];
}

/** The evidence one judgement gives for a defect, crediting the entry at `index`, or none when it is undefined. */
function judgedMatch({ score, refs }: Judgement, id: string, index: number | undefined): StageMatch {
	const note = score.notes?.[id];

	const correction = score.adjudicated?.find(
		(item) => item.defect === id && (index === undefined ? !item.reports : item.reports && item.finding === index)
	);

	const weighed = correction && !correction.reports ? correction.finding : note?.reports ? null : note?.finding;
	const rejected = weighed === null || weighed === undefined || weighed === index ? undefined : refs[weighed];

	return {
		claim: index === undefined ? null : refs[index]!,
		by: correction ? 'adjudicated' : 'judged',
		reason: correction?.reason ?? score.reasons[id] ?? '',
		behavior: note?.behavior ?? '',
		cause: note?.cause ?? '',
		...(rejected ? { rejected } : {})
	};
}

/** The published call carried over to a candidate whose claim is the published one's. */
function reused(match: StageMatch, claim: ClaimRef | null): StageMatch {
	return { ...match, claim, by: match.by === 'adjudicated' ? 'adjudicated' : 'reused' };
}

/**
 * What became of a lost claim: the published finding that carries its id as
 * its own or a merged member's, when one does.
 */
function traceLoss(claim: ClaimRef, published: readonly ClaimRef[]): LostClaim {
	if (!claim.id || !published.some((ref) => ref.id)) return { claim, change: 'untraced' };

	const into = published.find((ref) => ref.id === claim.id || ref.memberIds?.includes(claim.id!));

	return into?.id ? { claim, change: 'changed', into: into.id } : { claim, change: 'disappeared' };
}

function lossReason(lost: LostClaim): string {
	if (lost.change === 'changed') return `merged into ${lost.into}, whose claim changed and does not report it`;
	if (lost.change === 'disappeared') return 'no published finding carries the claim';

	return 'the report records no candidate ids, so whether the claim merged or disappeared is unknown';
}

/**
 * A defect a shown finding reports reached every stage. The found and
 * verified stages credit the candidate that carries the shown claim, a
 * verified one first, or the shown claim itself when no candidate does.
 */
function publishedStage(match: StageMatch, pool: readonly PoolCandidate[], refs: readonly ClaimRef[]): DefectStage {
	const twins = refs.flatMap((ref, index) => (ref.hash === match.claim!.hash ? [index] : []));
	const twin = twins.length ? refs[twins[0]!]! : match.claim;
	const verifiedTwin = twins.find((index) => pool[index]!.verified);

	return {
		found: true,
		verified: true,
		published: true,
		matches: {
			found: reused(match, twin),
			verified: reused(match, verifiedTwin === undefined ? twin : refs[verifiedTwin]!),
			published: match
		}
	};
}

/**
 * A defect no shown finding reports: how far the judged candidates got with
 * it, and the stage that stopped the best of them, a verified one first.
 */
function unpublishedStage(
	id: string,
	pool: readonly PoolCandidate[],
	judged: { all: Judgement; verified: Judgement },
	published: { match: StageMatch; refs: readonly ClaimRef[] }
): DefectStage {
	const { all, verified } = judged;
	const raised = reporters(all.score, id);
	const proven = reporters(verified.score, id);
	const raisedVerified = raised.find((index) => pool[all.at[index]!]!.verified);

	const [verifiedIn, verifiedIndex]: [Judgement, number | undefined] = proven.length
		? [verified, proven[0]]
		: raisedVerified === undefined
			? [verified, undefined]
			: [all, raisedVerified];

	const best =
		verifiedIndex === undefined ? (raised.length ? all.at[raised[0]!] : undefined) : verifiedIn.at[verifiedIndex];

	/** A verified claim is also a found one, so the verified call stands for the found stage when it alone credits one. */
	const foundBy = raised.length || verifiedIndex === undefined ? judgedMatch(all, id, raised[0]) : undefined;

	const stage: DefectStage = {
		found: best !== undefined,
		verified: verifiedIndex !== undefined,
		published: false,
		matches: {
			found: foundBy ?? judgedMatch(verifiedIn, id, verifiedIndex),
			verified: judgedMatch(verifiedIn, id, verifiedIndex),
			published: published.match
		}
	};

	if (best === undefined) return stage;

	const candidate = pool[best]!;
	const lost = candidate.stage ? undefined : traceLoss(claimRef(candidate, candidate.id), published.refs);
	const reason = candidate.reason ?? (lost && lossReason(lost));

	return {
		...stage,
		stoppedAt: candidate.stage ?? 'consolidation',
		...(reason ? { reason } : {}),
		...(lost ? { lost } : {})
	};
}

/**
 * How far each defect got. The shown findings' score decides `published`.
 * A candidate whose claim is a shown finding's, word for word, takes that
 * finding's verdict instead of a second one, so the same text can never be
 * credited at one stage and not the next. Only the candidates whose claim
 * changed or never reached the shown findings were judged, all of them and
 * the verified ones apart, since the judge names one best claim per defect
 * and a dropped duplicate could otherwise win over a verified one.
 */
export function defectStages(
	defects: readonly LabeledDefect[],
	pool: readonly PoolCandidate[],
	published: Published,
	changed: ChangedScores
): Record<string, DefectStage> {
	const shownRefs = published.findings.map((finding, index) => claimRef(finding, published.ids?.[index]));
	const shownHashes = new Set(shownRefs.map((ref) => ref.hash));
	const refs = pool.map((candidate) => claimRef(candidate, candidate.id));
	const changedAt = pool.flatMap((_, index) => (shownHashes.has(refs[index]!.hash) ? [] : [index]));
	const verifiedAt = changedAt.filter((index) => pool[index]!.verified);
	const judgement = (score: PrScore, at: number[]): Judgement => ({ score, at, refs: at.map((index) => refs[index]!) });
	const shown: Judgement = { score: published.score, refs: shownRefs, at: [] };
	const judged = { all: judgement(changed.all, changedAt), verified: judgement(changed.verified, verifiedAt) };

	return Object.fromEntries(
		defects.map(({ id }) => {
			const match = judgedMatch(shown, id, published.score.found[id]);

			return [
				id,
				id in published.score.found
					? publishedStage(match, pool, refs)
					: unpublishedStage(id, pool, judged, { match, refs: shownRefs })
			];
		})
	);
}

/**
 * Judges a run's candidates and places each planted defect on the stage it
 * reached. The candidates whose claim is a shown finding's are not judged
 * again: they take the shown finding's verdict. When every other candidate
 * is verified, the two lists are the same and one verdict serves both, since
 * the judge can answer the same list differently twice.
 */
export async function judgeStages(
	defects: readonly LabeledDefect[],
	pool: readonly PoolCandidate[],
	published: Published,
	judge: Judged
): Promise<Record<string, DefectStage>> {
	const shown = new Set(published.findings.map(claimHash));
	const changed = pool.filter((candidate) => !shown.has(claimHash(candidate)));
	const proven = changed.filter((candidate) => candidate.verified);
	const scored = judge(changed);

	const [all, verified] = await Promise.all([scored, proven.length === changed.length ? scored : judge(proven)]);

	return defectStages(defects, pool, published, { all, verified });
}

/** Sums the stages of every run that kept its candidates. */
export function stageTotals(
	runs: readonly { defects: readonly LabeledDefect[]; stages: Record<string, DefectStage> }[]
): StageTotals {
	const totals: StageTotals = { planted: 0, found: 0, verified: 0, published: 0, stoppedAt: {} };

	for (const { defects, stages } of runs) {
		for (const { id } of defects) {
			const stage = stages[id];

			if (!stage) continue;

			totals.planted++;
			if (stage.found) totals.found++;
			if (stage.verified) totals.verified++;
			if (stage.published) totals.published++;
			if (stage.stoppedAt) totals.stoppedAt[stage.stoppedAt] = (totals.stoppedAt[stage.stoppedAt] ?? 0) + 1;
		}
	}

	return totals;
}
