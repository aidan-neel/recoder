import { findingKind, type Finding, type FindingLocation, type FindingVerification } from '@recoder/shared';
import { isHeldBack, toFinding, type CandidateFinding } from './consolidate.js';
import { claimTerms, refineFingerprint, sameClaim } from './harness/findings.js';

/** Strongest proof first: a run beats a deterministic check, which beats a trace or a convention. */
const PROOF_RANK: Record<NonNullable<FindingVerification['method']>, number> = {
	run: 0,
	detector: 1,
	rule: 1,
	trace: 2,
	convention: 3
};

const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

/** Earliest raised first; the id settles candidates that share a candidate id, so the order is total. */
const byId = (a: CandidateFinding, b: CandidateFinding) =>
	a.candidateId.localeCompare(b.candidateId, 'en', { numeric: true }) || a.id.localeCompare(b.id);

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

/**
 * One finding for a merge group: the representative's body, with every
 * member's evidence and locations, the first checked patch, and every member's
 * id, so an evaluation can trace the finding to each report behind it.
 */
function mergeCluster(group: CandidateFinding[]): Finding {
	const members = [...group].sort(byId);
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

	for (const member of members) {
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
		patch: lead.patch ?? members.find((member) => member.patch)?.patch,
		memberIds: members.map((member) => member.id)
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
 * The place two reports must share to be compared as one issue: the same
 * fingerprint (file, kind, symbol and first line's text) starting on the same
 * line. Reports on nearby or overlapping lines stay apart, because two
 * different bugs in one function often overlap and a duplicate costs less than
 * a lost bug.
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

/** The place a candidate is compared at: the one its title already opened in this file, else the one at its merge key. */
function groupKey(candidate: CandidateFinding, byTitle: Map<string, string>): string {
	const key = mergeKey(candidate);
	const title = titleKey(candidate);

	if (!title) return key;
	if (!byTitle.has(title)) byTitle.set(title, key);

	return byTitle.get(title)!;
}

/**
 * Splits the reports at one place into the defects they claim. A shared
 * place, category, fingerprint or title is no proof of one defect, so a report
 * joins a group only when its claim matches every claim already in it; one
 * report that mentions two defects cannot chain them together.
 */
function byClaim(reports: CandidateFinding[]): CandidateFinding[][] {
	const groups: { members: CandidateFinding[]; claims: Set<string>[] }[] = [];

	for (const report of reports) {
		const claim = claimTerms(report);
		const group = groups.find((entry) => entry.claims.every((other) => sameClaim(claim, other)));

		if (group) {
			group.members.push(report);
			group.claims.push(claim);
		} else {
			groups.push({ members: [report], claims: [claim] });
		}
	}

	return groups.map((group) => group.members);
}

/**
 * The fingerprint, unchanged unless an earlier finding holds it. Then it is
 * refined by its place (the same line text in two places), and by a count too
 * when distinct claims on one line share both, so no two findings share one.
 */
function distinctFingerprint(fingerprint: string, place: string, seen: ReadonlySet<string>): string {
	let distinct = fingerprint;

	for (let count = 1; seen.has(distinct); count++) {
		distinct = refineFingerprint(fingerprint, count === 1 ? place : `${place}:${count}`);
	}

	return distinct;
}

/**
 * Deterministic consolidation of verified candidates, without a model.
 * Candidates sharing a merge key, or a bug title in one file, are compared by
 * what they claim, and reports of one defect become one finding. Candidates
 * are sorted first, so the findings do not depend on the order they arrive in.
 * Findings that still share a fingerprint keep apart by refining it. Quality
 * findings never rank above medium. This is where the reporting bar applies:
 * a group whose every member is below the bar is held back, and one with a
 * member above it is published.
 */
export function consolidateFindings(candidates: CandidateFinding[]): Finding[] {
	const groups = new Map<string, CandidateFinding[]>();
	const byTitle = new Map<string, string>();

	for (const candidate of [...candidates].sort(byId)) {
		if (!candidate.valid || candidate.verification?.status !== 'verified') continue;

		const key = groupKey(candidate, byTitle);

		groups.set(key, [...(groups.get(key) ?? []), candidate]);
	}

	const findings = [...groups.values()]
		.flatMap(byClaim)
		.filter((members) => members.some((member) => !isHeldBack(member)))
		.map(mergeCluster);

	const seen = new Set<string>();

	for (const finding of findings.sort(compareFindings)) {
		if (!finding.fingerprint) continue;

		finding.fingerprint = distinctFingerprint(
			finding.fingerprint,
			`${finding.side ?? 'new'}:${finding.line ?? 0}`,
			seen
		);

		seen.add(finding.fingerprint);
	}

	return findings;
}
