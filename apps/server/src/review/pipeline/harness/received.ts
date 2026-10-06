import type {
	CitedVia,
	ContextItem,
	ContextKind,
	ContextOmission,
	Finding,
	FindingCitation,
	ReviewContext,
	ReviewerContext,
	UnitContext
} from '@recoder/shared';
import type { EvidenceStore, ToolCallReport } from '../../../evidence/evidence.js';
import type { UnitContextParts } from '../change-model/lookup.js';
import type { CandidateFinding } from '../consolidate.js';
import type { ReviewInventory } from '../inventory.js';
import type { ReviewUnit } from '../units.js';
import type { ScopedPatch } from './pool.js';
import type { HarnessEvents } from './types.js';

/** Reads listed per reviewer; the rest are only counted, so a long investigation can't grow the record without bound. */
const MAX_READS = 200;

/** Omissions a unit lists per reason; past it they are only counted, so a large diff's cut declarations stay small. */
const MAX_LISTED_OMISSIONS = 50;

/** The retrievals that hand a reviewer code or paths, by the kind of context each returns. */
const READ_KINDS: Partial<Record<string, ContextKind>> = {
	readFile: 'source',
	readDiff: 'diff',
	search: 'search',
	listFiles: 'list'
};

/** One finished retrieval a reviewer made, as a place and never its content. */
interface RecordedRead {
	action: string;
	path: string;
	startLine?: number;
	endLine?: number;
	hunkIds?: string[];
	evidenceId?: string;
	ok: boolean;
	/** A bound cut the result: the file read's size cap, or the patch page or round budget for a diff. */
	truncated: boolean;
}

/** What a reviewer's prompt held, captured when it was built, so a replay or resume never rebuilds it. */
interface CapturedPrompt {
	lens?: string;
	/** Retrievals the initial scoped patch made, the first of the reviewer's reads, and the evidence ids they returned. */
	patchReads: number;
	patch: string[];
	context: UnitContext;
}

/**
 * What every reviewer received, by assignment id: its prompt as built, its
 * reads in call order, and how many reads past the cap were only counted.
 */
export interface Received {
	prompts: Record<string, CapturedPrompt>;
	byAssignment: Record<string, RecordedRead[]>;
	dropped: Record<string, number>;
}

export function emptyReceived(): Received {
	return { prompts: {}, byAssignment: {}, dropped: {} };
}

type ReviewerTool = ToolCallReport & { assignmentId?: string; role?: string };

function recordRead(received: Received, evidence: EvidenceStore, tool: ReviewerTool): void {
	const id = tool.assignmentId;
	const action = tool.input?.action;

	if (!id || tool.status === 'running' || !action || !READ_KINDS[action]) return;

	const list = (received.byAssignment[id] ??= []);

	if (list.length >= MAX_READS) {
		received.dropped[id] = (received.dropped[id] ?? 0) + 1;

		return;
	}

	const stored = tool.result?.evidenceId ? evidence.get(tool.result.evidenceId) : undefined;
	const path = stored?.path ?? tool.input?.path ?? tool.input?.prefix ?? '.';

	list.push({
		action,
		path,
		...(stored ? { startLine: stored.startLine, endLine: stored.endLine } : lines(tool.input)),
		...(tool.input?.hunkIds ? { hunkIds: tool.input.hunkIds } : {}),
		...(tool.result?.evidenceId ? { evidenceId: tool.result.evidenceId } : {}),
		ok: tool.status === 'done',
		truncated: Boolean(tool.result?.cut || stored?.truncated)
	});
}

function lines(input: ToolCallReport['input']): { startLine?: number; endLine?: number } {
	return input?.startLine ? { startLine: input.startLine, endLine: input.endLine ?? input.startLine } : {};
}

/** The run's events with every finished reviewer retrieval also recorded in `received`. */
export function recordingReads(
	received: Received,
	evidence: EvidenceStore,
	events: HarnessEvents | undefined
): HarnessEvents {
	return {
		...events,
		onTool: (tool) => {
			recordRead(received, evidence, tool);
			events?.onTool?.(tool);
		}
	};
}

/** The prompts and reads of the given assignments only, for a checkpoint that keeps finished work. */
export function receivedOf(received: Received, ids: Set<string>): Received {
	const keep = <T>(entries: Record<string, T>) =>
		Object.fromEntries(Object.entries(entries).filter(([id]) => ids.has(id)));

	return structuredClone({
		prompts: keep(received.prompts),
		byAssignment: keep(received.byAssignment),
		dropped: keep(received.dropped)
	});
}

/** The hunks of a scope entry: the listed ones, or every hunk of the file when it lists none. */
function scopedHunks(entry: ReviewUnit['scope'][number], inventory: ReviewInventory) {
	const file = inventory.files.find((candidate) => candidate.path === entry.path);
	const wanted = new Set(entry.hunkIds);

	return (file?.hunks ?? []).filter((hunk) => !wanted.size || wanted.has(hunk.id));
}

function hunkItem(path: string, hunk: { newStart: number; newCount: number }): ContextItem {
	return { kind: 'diff', path, startLine: hunk.newStart, endLine: hunk.newStart + Math.max(hunk.newCount - 1, 0) };
}

/** The first `MAX_LISTED_OMISSIONS` of each reason, and how many more of each there were. */
function listed(omitted: ContextOmission[]): Pick<UnitContext, 'omitted' | 'omittedPast'> {
	const kept: ContextOmission[] = [];
	const past: Partial<Record<ContextOmission['reason'], number>> = {};
	const seen: Partial<Record<ContextOmission['reason'], number>> = {};

	for (const item of omitted) {
		seen[item.reason] = (seen[item.reason] ?? 0) + 1;

		if (seen[item.reason]! <= MAX_LISTED_OMISSIONS) kept.push(item);
		else past[item.reason] = (past[item.reason] ?? 0) + 1;
	}

	return { omitted: kept, ...(Object.keys(past).length ? { omittedPast: past } : {}) };
}

/**
 * Records what a reviewer's prompt holds as it is built: each scoped hunk the
 * initial patch delivered, over its new-side lines, and each one a budget cut
 * as a diff-cap omission, with the change model's declarations, callers,
 * tests, siblings and contracts and what their bounds left out.
 */
export function capturePrompt(
	received: Received,
	unit: ReviewUnit,
	inventory: ReviewInventory,
	declarations: Pick<UnitContextParts, 'supplied' | 'omitted'> | null,
	patch: ScopedPatch
): void {
	const supplied: ContextItem[] = [];
	const omitted: ContextOmission[] = [];

	for (const entry of unit.scope) {
		const result = patch.find((item) => item.path === entry.path);
		const shown = result?.ok ? new Set(result.hunkIds) : new Set<string>();

		for (const hunk of scopedHunks(entry, inventory)) {
			if (shown.has(hunk.id)) supplied.push(hunkItem(entry.path, hunk));
			else omitted.push({ ...hunkItem(entry.path, hunk), reason: 'diff-cap' });
		}
	}

	received.prompts[unit.id] = {
		...(unit.lens ? { lens: unit.lens } : {}),
		patchReads: patch.length,
		patch: patch.flatMap((result) => (result.evidenceId ? [result.evidenceId] : [])),
		context: {
			supplied: [...supplied, ...(declarations?.supplied ?? [])],
			...listed([...(declarations?.omitted ?? []), ...omitted])
		}
	};
}

/** What the record is built from: the run's known units (for order and lens), roles, prompts, reads, evidence and candidates. */
export interface ReceivedSources {
	units: ReviewUnit[];
	roles: Map<string, string>;
	received: Received;
	evidence: EvidenceStore;
	candidates: CandidateFinding[];
}

function readItem(read: RecordedRead): ContextItem {
	const { startLine, endLine } = read;

	return { kind: READ_KINDS[read.action] ?? 'source', path: read.path, ...(startLine ? { startLine, endLine } : {}) };
}

/** What bounds cut from the reviewer's own reads: a file read past its size cap, or a patch page past its budget. */
function readOmissions(reads: RecordedRead[]): ContextOmission[] {
	return reads
		.filter((read) => read.ok && read.truncated && (read.action === 'readFile' || read.action === 'readDiff'))
		.map((read) => ({ ...readItem(read), reason: read.action === 'readFile' ? 'file-cap' : 'diff-cap' }));
}

/**
 * Supplied kinds whose text the prompt holds: the patch, and the one source
 * line of each caller, reference or contract. A declaration, test or sibling
 * is named by place only, so citing its lines means the reviewer read them.
 */
const SHOWN_KINDS = new Set<ContextKind>(['diff', 'caller', 'reference', 'contract']);

/**
 * Whether the cited range lies inside text the prompt already gave: the same
 * path, and every cited line within the supplied lines. Without line numbers on
 * either side nothing shows the text was given, so it is not covered.
 */
function covers(item: ContextItem, cited: ContextItem): boolean {
	if (!SHOWN_KINDS.has(item.kind) || item.path !== cited.path || !item.startLine || !cited.startLine) return false;

	return cited.startLine >= item.startLine && (cited.endLine ?? cited.startLine) <= (item.endLine ?? item.startLine);
}

/** How one reviewer had each evidence id it could cite. */
type Classifier = (evidenceId: string) => (ContextItem & { via: CitedVia }) | null;

function classifier(
	sources: ReceivedSources,
	supplied: ContextItem[],
	reads: RecordedRead[],
	patch: string[]
): Classifier {
	const patchIds = new Set(patch);

	return (evidenceId) => {
		const record = sources.evidence.get(evidenceId);
		const read = reads.find((entry) => entry.evidenceId === evidenceId);

		if (record?.kind === 'run') return null;

		const item = read
			? readItem(read)
			: record
				? { kind: 'source' as const, path: record.path, startLine: record.startLine, endLine: record.endLine }
				: null;

		if (!item) return null;

		const via: CitedVia =
			patchIds.has(evidenceId) || supplied.some((place) => covers(place, item))
				? 'supplied'
				: read
					? 'read'
					: 'unknown';

		return { ...item, via };
	};
}

/** One reviewer's record, what its prompt held, and how it had each evidence id its candidates cited. */
function reviewerContext(
	sources: ReceivedSources,
	id: string,
	lens: string | undefined
): { record: ReviewerContext; prompt: UnitContext | undefined; classify: Classifier } {
	const prompt = sources.received.prompts[id];
	const reads = sources.received.byAssignment[id] ?? [];
	const own = reads.slice(prompt?.patchReads ?? 0);
	const classify = classifier(sources, prompt?.context.supplied ?? [], reads, prompt?.patch ?? []);
	const candidates = sources.candidates.filter((candidate) => candidate.assignmentId === id);

	const cited = [...new Set(candidates.flatMap((candidate) => candidate.evidenceIds ?? []))].flatMap(
		(evidenceId) => classify(evidenceId) ?? []
	);

	const dropped = sources.received.dropped[id];
	const lensId = prompt?.lens ?? lens;

	const record = {
		assignmentId: id,
		role: sources.roles.get(id) ?? 'reviewer',
		...(lensId ? { lens: lensId } : {}),
		read: own.filter((read) => read.ok).map(readItem),
		cited,
		omitted: readOmissions(own),
		...(dropped ? { readsDropped: dropped } : {})
	};

	return { record, prompt: prompt?.context, classify };
}

/**
 * Where a reviewer's prompt is stored: under its slice (`unit-2` for `unit-2/security`)
 * when that holds the same prompt, else under its own id, as a split retry's narrower scope does.
 */
function intern(units: Record<string, UnitContext>, assignmentId: string, prompt: UnitContext): string {
	const slice = assignmentId.split('/')[0];

	for (const key of [slice, assignmentId]) {
		const stored = units[key];

		if (!stored) {
			units[key] = prompt;

			return key;
		}

		if (Bun.deepEquals(stored, prompt)) return key;
	}

	return assignmentId;
}

/** How a published finding's reporters had what they cited, counted per member and evidence id rather than the best way. */
function findingCitation(
	finding: Finding,
	sources: ReceivedSources,
	classifiers: Map<string, Classifier>
): FindingCitation {
	const ids = new Set(finding.memberIds ?? [finding.id]);
	const members = sources.candidates.filter((candidate) => ids.has(candidate.id));
	const cited: Record<CitedVia, number> = { supplied: 0, read: 0, unknown: 0 };
	let readBy = 0;

	for (const member of members) {
		const classify = member.assignmentId ? classifiers.get(member.assignmentId) : undefined;
		const vias = classify ? (member.evidenceIds ?? []).flatMap((id) => classify(id)?.via ?? []) : [];

		for (const via of vias) cited[via]++;

		if (vias.includes('read')) readBy++;
	}

	return { findingId: finding.id, cited, members: members.length, readBy };
}

/**
 * The reviewers to record: every assignment that built a prompt or made a
 * read, the run's units first in their order, then any other kind of pool
 * assignment by id.
 */
function reviewerIds(sources: ReceivedSources): string[] {
	const seen = new Set([...Object.keys(sources.received.prompts), ...Object.keys(sources.received.byAssignment)]);
	const known = sources.units.map((unit) => unit.id).filter((id) => seen.has(id));
	const others = [...seen].filter((id) => !known.includes(id)).sort();

	return [...new Set([...known, ...others])];
}

/**
 * What each reviewer received in its prompt, read with its own tools and
 * cited as evidence, what bounds left out, and how each published finding's
 * evidence reached its reporters. The prompt part is the one captured when the
 * prompt was built, never rebuilt from the current change model; a reviewer
 * without one (a checkpoint from before prompts were kept) has no `unit`.
 */
export function reviewContext(sources: ReceivedSources, findings: Finding[]): ReviewContext {
	const lenses = new Map(sources.units.map((unit) => [unit.id, unit.lens]));
	const classifiers = new Map<string, Classifier>();
	const prompts: Record<string, UnitContext> = {};
	const reviewers: ReviewerContext[] = [];

	for (const id of reviewerIds(sources)) {
		const { record, prompt, classify } = reviewerContext(sources, id, lenses.get(id));

		reviewers.push(prompt ? { ...record, unit: intern(prompts, id, prompt) } : record);
		classifiers.set(id, classify);
	}

	return {
		units: prompts,
		reviewers,
		findings: findings.map((finding) => findingCitation(finding, sources, classifiers))
	};
}
