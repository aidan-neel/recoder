import type { ReadabilitySmell } from '@recoder/shared';
import type { CandidateFinding } from '../consolidate.js';
import { hunkAt } from '../harness/findings.js';
import type { ReviewInventory } from '../inventory.js';
import { clip } from '../schemas.js';
import type { ReviewUnit } from '../units.js';
import type { CoChange } from './co-change.js';
import { CONTRACT_CHECK_TASK, RESIDUAL_TASK } from './prompts.js';

/** Raised candidates listed in a residual task, at most; past this the list stops helping. */
const MAX_LISTED = 40;

/** Smells that say a comment, name or doc and the code disagree, where either side can be the defect. */
const CONTRACT_SMELLS: ReadonlySet<ReadabilitySmell> = new Set([
	'stale-comment',
	'misleading-name',
	'hidden-side-effect'
]);

function headline(candidate: CandidateFinding): string {
	return String(clip((candidate.title ?? candidate.message.split('\n')[0]).replace(/\s+/g, ' ').trim(), 100));
}

function place(candidate: CandidateFinding): string {
	return candidate.line ? `${candidate.file}:${candidate.line}` : candidate.file;
}

/**
 * Each candidate the review raised, once: those on the unit's files first,
 * then the rest, which a pass reading past its unit would otherwise find again.
 */
function raisedLines(slice: ReviewUnit, candidates: CandidateFinding[]): string[] {
	const paths = new Set(slice.scope.map((entry) => entry.path));
	const own = candidates.filter((candidate) => paths.has(candidate.file));
	const rest = candidates.filter((candidate) => !paths.has(candidate.file));

	const lines = [...own, ...rest].map(
		(candidate) => `- [${candidate.category ?? 'finding'}] ${headline(candidate)} (${place(candidate)})`
	);

	return [...new Set(lines)];
}

function coChangeLines(hints: CoChange[]): string {
	if (!hints.length) return '';

	const lines = hints.map(
		(hint) => `- ${hint.file} changed with ${hint.with} in ${hint.together} of the last ${hint.of} commits`
	);

	return `\n\nFiles that usually change together with this unit's files, but that this pull request leaves unchanged:\n${lines.join('\n')}\nCheck whether this change needs a matching edit in them (an export, a registration, a version, a migration, a doc). A missing one is a defect on the line of this unit that needs it.`;
}

/**
 * One residual pass per review unit, in unit order, up to `cap`: a subagent
 * told what the review already raised and asked for what the unit's lenses missed,
 * with the files that usually change alongside the unit's files.
 */
export function residualUnits(
	slices: ReviewUnit[],
	candidates: CandidateFinding[],
	hints: Map<string, CoChange[]>,
	cap: number
): ReviewUnit[] {
	return slices.slice(0, Math.max(0, cap)).map((slice, index) => {
		const raised = raisedLines(slice, candidates);
		const listed = raised.slice(0, MAX_LISTED);
		const more = raised.length > listed.length ? `\n- …and ${raised.length - listed.length} more` : '';

		return {
			id: `residual-${index + 1}`,
			title: `Second look: ${slice.title}`,
			reason: `${RESIDUAL_TASK}\n\nAlready raised in this review, this unit's files first (${raised.length}):\n${listed.join('\n') || '- nothing'}${more}${coChangeLines(hints.get(slice.id) ?? [])}`,
			scope: slice.scope.map((entry) => ({ ...entry, hunkIds: [...entry.hunkIds] })),
			purpose: 'residual'
		};
	});
}

/** The hunk holding the candidate's line, else every hunk of its file; empty when the file isn't reviewed. */
function candidateScope(candidate: CandidateFinding, inventory: ReviewInventory): ReviewUnit['scope'] {
	const file = inventory.files.find((entry) => entry.path === candidate.file);

	if (!file || file.excludeReason || file.summarize || !file.hunks.length) return [];

	const hunkId = hunkAt(inventory, candidate.file, candidate.line, candidate.side ?? 'new');

	return [{ path: file.path, hunkIds: hunkId ? [hunkId] : file.hunks.map((hunk) => hunk.id) }];
}

/**
 * A contract check for each valid readability candidate whose smell says a
 * comment, name or doc and the code disagree, one per place, in the order
 * they were raised, up to `cap`. The check decides which side is wrong.
 */
export function contractCheckUnits(
	candidates: CandidateFinding[],
	inventory: ReviewInventory,
	cap: number
): ReviewUnit[] {
	const seen = new Set<string>();
	const units: ReviewUnit[] = [];

	for (const candidate of candidates) {
		if (units.length >= cap) break;
		if (!candidate.valid || candidate.category !== 'readability') continue;
		if (!candidate.smell || !CONTRACT_SMELLS.has(candidate.smell) || seen.has(place(candidate))) continue;

		const scope = candidateScope(candidate, inventory);

		if (!scope.length) continue;

		seen.add(place(candidate));

		units.push({
			id: `contract-${units.length + 1}`,
			title: `Check the contract: ${headline(candidate)}`,
			reason: `A readability reviewer reported this at ${place(candidate)} (${candidate.smell}):\n"${headline(candidate)}": ${String(clip(candidate.message, 600))}\n\n${CONTRACT_CHECK_TASK}`,
			scope,
			purpose: 'contract-check'
		});
	}

	return units;
}
