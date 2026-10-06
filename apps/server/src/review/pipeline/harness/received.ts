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

/** Each scoped file's patch, over the new-side lines its hunks span. */
function patchItems(unit: ReviewUnit, inventory: ReviewInventory): ContextItem[] {
	return unit.scope.map((entry) => {
		const file = inventory.files.find((candidate) => candidate.path === entry.path);
		const wanted = new Set(entry.hunkIds);
		const hunks = (file?.hunks ?? []).filter((hunk) => !wanted.size || wanted.has(hunk.id));

		if (!hunks.length) return { kind: 'diff', path: entry.path };

		return {
			kind: 'diff',
			path: entry.path,
			startLine: Math.min(...hunks.map((hunk) => hunk.newStart)),
			endLine: Math.max(...hunks.map((hunk) => hunk.newStart + Math.max(hunk.newCount - 1, 0)))
		};
	});
}

function readItem(read: RecordedRead): ContextItem {
	const { startLine, endLine } = read;

	return { kind: READ_KINDS[read.action] ?? 'source', path: read.path, ...(startLine ? { startLine, endLine } : {}) };
}

/** A read a bound cut: a file read past its size cap, or a patch page past its budget. */
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

/** Whether the cited range lies on text the prompt already gave: the same path, overlapping lines when both have them. */
function covers(item: ContextItem, cited: ContextItem): boolean {
	if (!SHOWN_KINDS.has(item.kind) || item.path !== cited.path) return false;
	if (!item.startLine || !cited.startLine) return true;

	return cited.startLine <= (item.endLine ?? item.startLine) && (cited.endLine ?? cited.startLine) >= item.startLine;
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
	const supplied = [...patchItems(unit, sources.inventory), ...parts.supplied];
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
		omitted: [...parts.omitted, ...readOmissions(reads)],
		...(dropped ? { readsDropped: dropped } : {})
	};

	return { record, classify };
}

const VIA_RANK: Record<FindingCitation['via'], number> = { supplied: 0, read: 1, unknown: 2, none: 3 };

/** How a published finding's reporters had what they cited: supplied wins over read, read over unknown. */
function findingCitation(
	finding: Finding,
	sources: ReceivedSources,
	classifiers: Map<string, Classifier>
): FindingCitation {
	const ids = new Set(finding.memberIds ?? [finding.id]);
	const members = sources.candidates.filter((candidate) => ids.has(candidate.id));

	const vias = members.flatMap((member) => {
		const classify = member.assignmentId ? classifiers.get(member.assignmentId) : undefined;

		return classify ? (member.evidenceIds ?? []).flatMap((id) => classify(id)?.via ?? []) : [];
	});

	const via = vias.reduce<FindingCitation['via']>(
		(best, next) => (VIA_RANK[next] < VIA_RANK[best] ? next : best),
		'none'
	);

	return { findingId: finding.id, via };
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
