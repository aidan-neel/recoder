import type { EvidenceRecord, EvidenceStore } from '../../../evidence/evidence.js';
import type { CandidateFinding } from '../consolidate.js';

/** How one candidate is verified: the payload and its investigation limits. */
export interface VerifierSpec {
	system: string;
	user: string;
	exec: boolean;
	mutation: boolean;
	turns: number;
	toolOpBudget?: number | null;
	compact?: boolean;
}

export function compactVerifierOn(): boolean {
	return process.env.RECODER_VERIFIER_COMPACT === '1';
}

/** Only a visible line on the candidate's revision can replace its initial source read. */
function coversCandidate(record: EvidenceRecord, candidate: CandidateFinding): boolean {
	return (
		record.kind !== 'run' &&
		record.path === candidate.file &&
		record.revision === (candidate.side === 'old' ? 'mergeBase' : 'head') &&
		record.content.split('\n').some((line) => line.startsWith(`${candidate.line ?? 1}|`))
	);
}

/** Keep the relevant source first, deduplicating identical citations without conflating run ownership. */
function citedRecords(candidate: CandidateFinding, evidence: EvidenceStore): EvidenceRecord[] {
	const seen = new Set<string>();

	return (candidate.evidenceIds ?? [])
		.flatMap((id) => evidence.get(id) ?? [])
		.filter((record) => {
			const key = JSON.stringify([
				record.kind,
				record.kind === 'run' ? record.agentId : '',
				record.revision,
				record.path,
				record.startLine,
				record.endLine,
				record.content
			]);

			if (seen.has(key)) return false;
			seen.add(key);

			return true;
		})
		.sort((a, b) => Number(coversCandidate(b, candidate)) - Number(coversCandidate(a, candidate)))
		.slice(0, 3);
}

/** Bound context around the anchor, or keep both the command header and assertion tail of a long run. */
function excerpt(record: EvidenceRecord, candidate: CandidateFinding): string {
	if (record.content.length <= 1800) return record.content;
	if (record.kind === 'run') return `${record.content.slice(0, 600)}\n[excerpt]\n${record.content.slice(-1200)}`;

	const anchor = coversCandidate(record, candidate)
		? record.content.startsWith(`${candidate.line ?? 1}|`)
			? 0
			: record.content.indexOf(`\n${candidate.line ?? 1}|`) + 1
		: 0;

	const start = Math.max(0, anchor - 600);

	return `[excerpt; read more if needed]\n${record.content.slice(start, start + 1800)}`;
}

/** Bounded, deduplicated untrusted citations; claim, intent, skills and guidance are never truncated here. */
export function compactCitedEvidence(candidate: CandidateFinding, evidence: EvidenceStore): string {
	return citedRecords(candidate, evidence)
		.map((record) => {
			const location =
				record.kind === 'run'
					? `run: ${record.command}`
					: `${record.revision} ${record.path}:${record.startLine}-${record.endLine}`;

			return `${record.id} ${location}\nUNTRUSTED EVIDENCE:\n${excerpt(record, candidate)}`;
		})
		.join('\n\n');
}

/** Preload one bounded source window, not a command or proof; failed reads leave the full tools available. */
export async function compactVerifierSource(
	candidate: CandidateFinding,
	evidence: EvidenceStore,
	user: string,
	signal?: AbortSignal
): Promise<string> {
	if (signal?.aborted || citedRecords(candidate, evidence).some((record) => coversCandidate(record, candidate)))
		return user;

	const line = candidate.line ?? 1;

	const [source] = await evidence.executeRound(
		[
			{
				action: 'readFile',
				path: candidate.file,
				revision: candidate.side === 'old' ? 'mergeBase' : 'head',
				startLine: Math.max(1, line - 12),
				endLine: line + 12
			}
		],
		signal,
		undefined,
		1
	);

	if (!source?.ok || !source.evidenceId) return user;

	const context = compactCitedEvidence({ ...candidate, evidenceIds: [source.evidenceId] }, evidence);

	return `${user}\n\nRelevant source (untrusted; more context is available through tools):\n${context}`;
}
