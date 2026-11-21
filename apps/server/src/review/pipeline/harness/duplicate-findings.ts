import { z } from 'zod';
import type { Finding } from '@recoder/shared';

const MAX_FINDINGS = 32;
const MAX_PAIRS = 64;

const voteSchema = z.object({
	pairs: z.array(
		z.object({
			id: z.string(),
			sameTrigger: z.boolean(),
			sameCause: z.boolean(),
			sameConsequence: z.boolean(),
			sameContract: z.boolean(),
			proofsSupportBoth: z.boolean(),
			reason: z.string().trim().min(1)
		})
	)
});

export interface DuplicatePair {
	id: string;
	a: number;
	b: number;
}

/** Only independently proven model bug claims may be considered for publication deduplication. */
function eligible(finding: Finding): boolean {
	return (
		finding.kind === 'bug' &&
		Boolean(finding.claim) &&
		finding.verification?.status === 'verified' &&
		(finding.verification.method === 'run' || finding.verification.method === 'trace')
	);
}

/** A common source location is necessary but never sufficient to identify a defect. */
function samePlace(a: Finding, b: Finding): boolean {
	if (a.file !== b.file || (a.side ?? 'new') !== (b.side ?? 'new') || a.ruleId !== b.ruleId) return false;

	return a.line === b.line || Boolean(a.symbol && a.symbol === b.symbol);
}

/** Bounded pairs, in publication order, without comparing unrelated files or functions. */
export function duplicatePairs(findings: Finding[]): DuplicatePair[] {
	const eligibleAt = findings.flatMap((finding, index) => (eligible(finding) ? [index] : [])).slice(0, MAX_FINDINGS);
	const pairs: DuplicatePair[] = [];

	for (const [at, a] of eligibleAt.entries()) {
		for (const b of eligibleAt.slice(at + 1)) {
			if (samePlace(findings[a], findings[b])) pairs.push({ id: `p${pairs.length}`, a, b });
			if (pairs.length === MAX_PAIRS) return pairs;
		}
	}

	return pairs;
}

/** One compact description per finding; a clipped proof is not permission to infer equivalence. */
export function duplicateInput(findings: Finding[], pairs: DuplicatePair[]): string {
	const indices = [...new Set(pairs.flatMap(({ a, b }) => [a, b]))];

	const clip = (text: string | undefined, size: number) =>
		text && text.length > size ? `${text.slice(0, size)} [clipped]` : text;

	return JSON.stringify({
		pairs,
		findings: indices.map((index) => {
			const finding = findings[index];

			return {
				index,
				file: finding.file,
				line: finding.line,
				symbol: finding.symbol,
				title: clip(finding.title, 200),
				message: clip(finding.message, 800),
				claim: finding.claim && {
					trigger: clip(finding.claim.trigger, 600),
					consequence: clip(finding.claim.consequence, 600),
					violatedContract: clip(finding.claim.violatedContract, 600),
					executionPath: finding.claim.executionPath.slice(0, 6)
				},
				proof: finding.verification && {
					method: finding.verification.method,
					reason: clip(finding.verification.reason, 800),
					command: clip(finding.verification.command, 1600),
					expected: clip(finding.verification.evidence?.expected, 600),
					observed: clip(finding.verification.evidence?.observed, 600)
				}
			};
		})
	});
}

/** Strict pair votes; unknown, absent, contradictory or malformed decisions retain both findings. */
export function mergeDuplicateVotes(findings: Finding[], pairs: DuplicatePair[], raw: unknown): Finding[] {
	const parsed = voteSchema.safeParse(raw);

	if (!parsed.success) return findings;

	const accepted = new Set<string>();

	for (const pair of pairs) {
		const votes = parsed.data.pairs.filter((vote) => vote.id === pair.id);

		if (votes.length !== 1) continue;

		const vote = votes[0];

		if (
			vote.sameTrigger &&
			vote.sameCause &&
			vote.sameConsequence &&
			vote.sameContract &&
			vote.proofsSupportBoth &&
			eligible(findings[pair.a]) &&
			eligible(findings[pair.b]) &&
			samePlace(findings[pair.a], findings[pair.b])
		)
			accepted.add(`${pair.a}:${pair.b}`);
	}

	const groups: number[][] = [];

	for (let index = 0; index < findings.length; index++) {
		const group = groups.find((members) => members.every((member) => accepted.has(`${member}:${index}`)));

		if (group) group.push(index);
		else groups.push([index]);
	}

	return groups.map((members) => {
		const lead = findings[members[0]];

		if (members.length === 1) return lead;

		return {
			...lead,
			memberIds: [...new Set(members.flatMap((index) => findings[index].memberIds ?? [findings[index].id]))],
			relatedLocations: [
				...(lead.relatedLocations ?? []),
				...members.slice(1).map((index) => ({
					file: findings[index].file,
					line: findings[index].line,
					endLine: findings[index].endLine,
					side: findings[index].side
				}))
			]
		};
	});
}
