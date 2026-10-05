import { findingKind, type Finding, type FindingLocation, type FindingVerification } from '@recoder/shared';
import { isHeldBack, toFinding, type CandidateFinding } from './consolidate.js';
import { refineFingerprint } from './harness/findings.js';

/** Strongest proof first: a run beats a deterministic check, which beats a trace or a convention. */
const PROOF_RANK: Record<NonNullable<FindingVerification['method']>, number> = {
	run: 0,
	detector: 1,
	rule: 1,
	trace: 2,
	convention: 3
};

const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

const byId = (a: CandidateFinding, b: CandidateFinding) =>
	a.candidateId.localeCompare(b.candidateId, 'en', { numeric: true });

function proofRank(candidate: CandidateFinding): number {
	return PROOF_RANK[candidate.verification?.method ?? 'convention'];
}

/**
 * The candidate that speaks for a merge group: one above the reporting bar,
 * then the strongest proof, then most severe, then the earliest raised.
 */
function representative(members: CandidateFinding[]): CandidateFinding {
	return [...members].sort(
		(a, b) =>
			Number(isHeldBack(a)) - Number(isHeldBack(b)) ||
			proofRank(a) - proofRank(b) ||
			(SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
			byId(a, b)
	)[0];
}

function locationKey(location: FindingLocation): string {
	return `${location.file}:${location.line ?? ''}:${location.endLine ?? ''}:${location.side ?? 'new'}`;
}

/** One finding for a merge group: the representative's body, with every member's evidence and locations, and the first checked patch. */
function mergeCluster(members: CandidateFinding[]): Finding {
	const lead = representative(members);
	const own = locationKey(lead);
	const seen = new Set([own]);
	const related: FindingLocation[] = [];

	const add = (location: FindingLocation) => {
		const key = locationKey(location);

		if (seen.has(key)) return;
		seen.add(key);
		related.push({ file: location.file, line: location.line, endLine: location.endLine, side: location.side });
	};

	for (const location of lead.relatedLocations ?? []) add(location);

	for (const member of [...members].sort(byId)) {
		if (member === lead) continue;
		add(member);
		for (const location of member.relatedLocations ?? []) add(location);
	}

	const evidenceIds = [...new Set([lead, ...members].flatMap((member) => member.evidenceIds ?? []))];
	const quality = findingKind(lead.category) === 'quality';

	return {
		...toFinding(lead),
		severity: quality && lead.severity === 'error' ? 'warning' : lead.severity,
		evidenceIds,
		relatedLocations: related.length ? related : undefined,
		patch: lead.patch ?? [...members].sort(byId).find((member) => member.patch)?.patch
	};
}

/** Bugs before quality, then most severe, then by place, so the same findings always list in the same order. */
function compareFindings(a: Finding, b: Finding): number {
	return (
		Number(findingKind(a.category) === 'quality') - Number(findingKind(b.category) === 'quality') ||
		(SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
		a.file.localeCompare(b.file) ||
		(a.line ?? 0) - (b.line ?? 0) ||
		(a.fingerprint ?? '').localeCompare(b.fingerprint ?? '')
	);
}

/**
 * The place two reports must share to be one issue: the same fingerprint
 * (file, kind, symbol and first line's text) starting on the same line.
 * Reports on nearby or overlapping lines stay apart, because two different
 * bugs in one function often overlap and a duplicate costs less than a lost bug.
 */
function mergeKey(candidate: CandidateFinding): string {
	if (!candidate.fingerprint) return candidate.candidateId;

	return `${candidate.fingerprint}:${candidate.side ?? 'new'}:${candidate.line ?? 0}`;
}

/**
 * What two lenses reporting one bug from different lines share: the file and
 * the title, compared without case or punctuation. Only bugs a model raised
 * have one; a detector repeats its title for every place it fires.
 */
function titleKey(candidate: CandidateFinding): string | null {
	const title = candidate.title
		?.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

	if (!title || candidate.kind !== 'bug' || candidate.agent?.startsWith('detector:')) return null;

	return `${candidate.file}\0${title}`;
}

/** The group a candidate joins: the one its title already opened in this file, else the one at its merge key. */
function groupKey(candidate: CandidateFinding, byTitle: Map<string, string>): string {
	const key = mergeKey(candidate);
	const title = titleKey(candidate);

	if (!title) return key;
	if (!byTitle.has(title)) byTitle.set(title, key);

	return byTitle.get(title)!;
}

/**
 * Deterministic consolidation of verified candidates, without a model.
 * Candidates sharing a merge key, or a bug title in one file, become one finding. Two findings that
 * still share a fingerprint (the same line text in two places) keep apart
 * by their line. Quality findings never rank above medium. This is where the
 * reporting bar applies: a group whose every member is below the bar is held
 * back, and one with a member above it is published.
 */
export function consolidateFindings(candidates: CandidateFinding[]): Finding[] {
	const groups = new Map<string, CandidateFinding[]>();
	const byTitle = new Map<string, string>();

	for (const candidate of candidates) {
		if (!candidate.valid || candidate.verification?.status !== 'verified') continue;

		const key = groupKey(candidate, byTitle);

		groups.set(key, [...(groups.get(key) ?? []), candidate]);
	}

	const findings = [...groups.values()]
		.filter((members) => members.some((member) => !isHeldBack(member)))
		.map(mergeCluster);

	const seen = new Set<string>();

	for (const finding of findings.sort(compareFindings)) {
		if (finding.fingerprint && seen.has(finding.fingerprint)) {
			finding.fingerprint = refineFingerprint(finding.fingerprint, `${finding.side ?? 'new'}:${finding.line ?? 0}`);
		}

		if (finding.fingerprint) seen.add(finding.fingerprint);
	}

	return findings;
}
