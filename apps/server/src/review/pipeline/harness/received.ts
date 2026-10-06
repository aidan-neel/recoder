import type {
	CitedVia,
	ContextItem,
	ContextKind,
	ContextOmission,
	Finding,
	FindingCitation,
	ReviewContext,
	ReviewerContext
} from '@recoder/shared';
import type { EvidenceStore, ToolCallReport } from '../../../evidence/evidence.js';
import { unitContextParts } from '../change-model/lookup.js';
import type { ChangeModel } from '../change-model/types.js';
import type { CandidateFinding } from '../consolidate.js';
import type { ReviewInventory } from '../inventory.js';
import type { ReviewUnit } from '../units.js';
import type { HarnessEvents } from './types.js';

/** Reads listed per reviewer; the rest are only counted, so a long investigation can't grow the record without bound. */
const MAX_READS = 200;

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
	/** `readDiff`: the hunks the page delivered; unset on a record from before they were kept. */
	shown?: string[];
	evidenceId?: string;
	ok: boolean;
	/** A bound cut the result: the file read's size cap, or the patch page or round budget for a diff. */
	truncated: boolean;
}

/** Every reviewer's reads by assignment id, in call order, and how many past the cap were only counted. */
export interface ReceivedReads {
	byAssignment: Record<string, RecordedRead[]>;
	dropped: Record<string, number>;
}

export function emptyReads(): ReceivedReads {
	return { byAssignment: {}, dropped: {} };
}

type ReviewerTool = ToolCallReport & { assignmentId?: string; role?: string };

function recordRead(reads: ReceivedReads, evidence: EvidenceStore, tool: ReviewerTool): void {
	const id = tool.assignmentId;
	const action = tool.input?.action;

	if (!id || tool.status === 'running' || !action || !READ_KINDS[action]) return;

	const list = (reads.byAssignment[id] ??= []);

	if (list.length >= MAX_READS) {
		reads.dropped[id] = (reads.dropped[id] ?? 0) + 1;

		return;
	}

	const stored = tool.result?.evidenceId ? evidence.get(tool.result.evidenceId) : undefined;
	const path = stored?.path ?? tool.input?.path ?? tool.input?.prefix ?? '.';

	list.push({
		action,
		path,
		...(stored ? { startLine: stored.startLine, endLine: stored.endLine } : lines(tool.input)),
		...(tool.input?.hunkIds ? { hunkIds: tool.input.hunkIds } : {}),
		...(tool.result?.hunkIds ? { shown: tool.result.hunkIds } : {}),
		...(tool.result?.evidenceId ? { evidenceId: tool.result.evidenceId } : {}),
		ok: tool.status === 'done',
		truncated: Boolean(tool.result?.cut || stored?.truncated)
	});
}

function lines(input: ToolCallReport['input']): { startLine?: number; endLine?: number } {
	return input?.startLine ? { startLine: input.startLine, endLine: input.endLine ?? input.startLine } : {};
}

/** The run's events with every finished reviewer retrieval also recorded in `reads`. */
export function recordingReads(
	reads: ReceivedReads,
	evidence: EvidenceStore,
	events: HarnessEvents | undefined
): HarnessEvents {
	return {
		...events,
		onTool: (tool) => {
			recordRead(reads, evidence, tool);
			events?.onTool?.(tool);
		}
	};
}

/** The reads of the given assignments only, for a checkpoint that keeps finished work. */
export function readsOf(reads: ReceivedReads, ids: Set<string>): ReceivedReads {
	const keep = <T>(entries: Record<string, T>) =>
		Object.fromEntries(Object.entries(entries).filter(([id]) => ids.has(id)));

	return structuredClone({ byAssignment: keep(reads.byAssignment), dropped: keep(reads.dropped) });
}

/** What the record is built from: the run's units, change model, reads, evidence and candidates. */
export interface ReceivedSources {
	units: ReviewUnit[];
	subagents: ReviewUnit[] | null;
	roles: Map<string, string>;
	inventory: ReviewInventory;
	changeModel: ChangeModel | null;
	reads: ReceivedReads;
	evidence: EvidenceStore;
	candidates: CandidateFinding[];
}

/** The initial scoped patch: the first reads of a unit, one `readDiff` per scoped file, made before its model runs. */
function patchReads(unit: ReviewUnit, reads: RecordedRead[]): RecordedRead[] {
	const paths = new Set(unit.scope.map((entry) => entry.path));

	return reads.slice(0, unit.scope.length).filter((read) => read.action === 'readDiff' && paths.has(read.path));
}

/** The hunks of a scope entry: the listed ones, or every hunk of the file when it lists none. */
function scopedHunks(entry: ReviewUnit['scope'][number], inventory: ReviewInventory) {
	const file = inventory.files.find((candidate) => candidate.path === entry.path);
	const wanted = new Set(entry.hunkIds);

	return (file?.hunks ?? []).filter((hunk) => !wanted.size || wanted.has(hunk.id));
}

/**
 * The hunks the initial patch put in the prompt, each over its new-side lines.
 * A page a budget cut keeps only the hunks it delivered, or none when the record
 * predates delivered hunks; a file with no patch read is taken as asked for.
 */
function patchItems(unit: ReviewUnit, inventory: ReviewInventory, patch: RecordedRead[]): ContextItem[] {
	return unit.scope.flatMap((entry) => {
		const read = patch.find((candidate) => candidate.path === entry.path);
		const shown = read?.truncated ? new Set(read.shown) : null;

		return scopedHunks(entry, inventory)
			.filter((hunk) => !shown || shown.has(hunk.id))
			.map((hunk) => ({ kind: 'diff' as const, path: entry.path, ...hunkLines(hunk) }));
	});
}

function hunkLines(hunk: { newStart: number; newCount: number }): { startLine: number; endLine: number } {
	return { startLine: hunk.newStart, endLine: hunk.newStart + Math.max(hunk.newCount - 1, 0) };
}

function readItem(read: RecordedRead): ContextItem {
	const { startLine, endLine } = read;

	return { kind: READ_KINDS[read.action] ?? 'source', path: read.path, ...(startLine ? { startLine, endLine } : {}) };
}

/**
 * What bounds cut from the reviewer's reads: a file read past its size cap, a
 * patch page past its budget, and for the initial patch each scoped hunk it did not deliver.
 */
function readOmissions(unit: ReviewUnit, inventory: ReviewInventory, reads: RecordedRead[], patch: RecordedRead[]) {
	return reads
		.filter((read) => read.ok && read.truncated && (read.action === 'readFile' || read.action === 'readDiff'))
		.flatMap((read): ContextOmission[] => {
			const entry = patch.includes(read) && read.shown ? unit.scope.find((item) => item.path === read.path) : undefined;

			if (!entry) return [{ ...readItem(read), reason: read.action === 'readFile' ? 'file-cap' : 'diff-cap' }];

			return scopedHunks(entry, inventory)
				.filter((hunk) => !read.shown?.includes(hunk.id))
				.map((hunk) => ({ kind: 'diff', path: read.path, ...hunkLines(hunk), reason: 'diff-cap' }));
		});
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
	patch: RecordedRead[]
): Classifier {
	const patchIds = new Set(patch.flatMap((read) => (read.evidenceId ? [read.evidenceId] : [])));

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

/** One unit's record, and how it had each evidence id its candidates cited. */
function reviewerContext(
	sources: ReceivedSources,
	unit: ReviewUnit
): { record: ReviewerContext; classify: Classifier } {
	const parts = sources.changeModel ? unitContextParts(sources.changeModel, unit.scope) : { supplied: [], omitted: [] };
	const reads = sources.reads.byAssignment[unit.id] ?? [];
	const patch = patchReads(unit, reads);
	const supplied = [...patchItems(unit, sources.inventory, patch), ...parts.supplied];
	const classify = classifier(sources, supplied, reads, patch);
	const own = sources.candidates.filter((candidate) => candidate.assignmentId === unit.id);

	const cited = [...new Set(own.flatMap((candidate) => candidate.evidenceIds ?? []))].flatMap(
		(id) => classify(id) ?? []
	);

	const dropped = sources.reads.dropped[unit.id];

	const record: ReviewerContext = {
		assignmentId: unit.id,
		role: sources.roles.get(unit.id) ?? 'reviewer',
		...(unit.lens ? { lens: unit.lens } : {}),
		supplied,
		read: reads.filter((read) => read.ok && !patch.includes(read)).map(readItem),
		cited,
		omitted: [...parts.omitted, ...readOmissions(unit, sources.inventory, reads, patch)],
		...(dropped ? { readsDropped: dropped } : {})
	};

	return { record, classify };
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
 * What each reviewer unit received in its prompt, read with its own tools and
 * cited as evidence, what bounds left out, and how each published finding's
 * evidence reached its reporters. The supplied part is rebuilt from the change
 * model and the unit's scope, which is exactly what built the prompt.
 */
export function reviewContext(sources: ReceivedSources, findings: Finding[]): ReviewContext {
	const units = new Map([...sources.units, ...(sources.subagents ?? [])].map((unit) => [unit.id, unit]));
	const classifiers = new Map<string, Classifier>();
	const reviewers: ReviewerContext[] = [];

	for (const unit of units.values()) {
		const { record, classify } = reviewerContext(sources, unit);

		reviewers.push(record);
		classifiers.set(unit.id, classify);
	}

	return { reviewers, findings: findings.map((finding) => findingCitation(finding, sources, classifiers)) };
}
