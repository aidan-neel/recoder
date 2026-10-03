import { GUIDELINES_PATH } from '@recoder/shared';
import type { EvidenceStore } from '../../../evidence/evidence.js';
import { configForOrchestrator } from '../../../models/models.js';
import { applyDirective, describeDirective, interpretInstructions } from '../../chat/directive.js';
import { composeGuidelines, readGlobalGuidelines, type GuidelinesInput } from '../../guidelines/guidelines.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import type { ReviewInventory } from '../inventory.js';
import { publishCoverage, type ReviewRun } from './context.js';
import type { HarnessEvents } from './types.js';

/** Instruction files read from the target revision, in this order. */
const INSTRUCTION_PATHS = [
	'AGENTS.md',
	'CLAUDE.md',
	'CONTRIBUTING.md',
	'.github/CONTRIBUTING.md',
	'docs/CONTRIBUTING.md'
];

/** The first stage: narrow the inventory to what the developer asked for, then gather guidance and guidelines. */
export async function understandChanges(run: ReviewRun): Promise<void> {
	const { inventory, evidence, events, task } = run;
	const signal = run.controller.signal;

	events?.onStage?.('understand');
	task('inventory', 'Understand changes', 'running', 'Building the change inventory', { kind: 'inventory' });

	await applyInstructions(run);

	run.coverage.seed(inventory);
	await loadGuidance(inventory, evidence, signal, events?.onTool);

	const guidelines = composeGuidelines({
		global: readGlobalGuidelines().content,
		repo: await loadRepoGuidelines(evidence, signal, events?.onTool)
	});

	inventory.guidelines = guidelines?.block ?? null;
	if (guidelines) events?.onGuidelines?.(guidelines.used);

	const count = inventory.files.length;

	task('inventory', 'Understand changes', 'done', `Inventoried ${count} changed path${count === 1 ? '' : 's'}`, {
		kind: 'inventory'
	});

	publishCoverage(run);
	if (!run.workspace) events?.onLog?.(`Reviewing without running code: ${run.execReason}`);
}

/**
 * The developer's instructions narrow the inventory before anything reads it, so
 * "only the Python files" holds for planning, sweeps and coverage alike. A resumed
 * review reapplies the directive it already read.
 */
async function applyInstructions(run: ReviewRun): Promise<void> {
	const { inventory, events, task } = run;
	const instructions = run.input.instructions?.trim();

	if (!run.directive && instructions) {
		task('instructions', 'Reading your instructions', 'running', 'Working out which files and lenses you asked for', {
			kind: 'planning',
			agent: 'correctness'
		});

		run.directive = await interpretInstructions(
			instructions,
			inventory,
			configForOrchestrator(),
			run.controller.signal,
			(message) => events?.onLog?.(message)
		);
	}

	if (!run.directive) return;

	const applied = applyDirective(inventory, run.directive);

	for (const glob of applied.droppedIncludes)
		events?.onLog?.(`Your instructions name ${glob}, which matches no changed file; reviewing the rest.`);

	task('instructions', 'Reading your instructions', 'done', describeDirective(run.directive, applied), {
		kind: 'planning',
		agent: 'correctness'
	});
}

/**
 * The repo layer of owner guidelines, read at the PR's base ("target") commit:
 * a pull request that edits the file does not change its own review.
 */
async function loadRepoGuidelines(
	evidence: EvidenceStore,
	signal: AbortSignal,
	onTool?: HarnessEvents['onTool']
): Promise<GuidelinesInput['repo']> {
	if (!evidence.revision) return null;

	try {
		const [path] = await evidence.existingFiles('target', [GUIDELINES_PATH], signal);

		if (!path) return null;

		const lines = REVIEW_POLICY.maxReadLines;

		const results = await evidence.executeRound(
			[
				{ action: 'readFile', revision: 'target', path, startLine: 1, endLine: lines },
				{ action: 'readFile', revision: 'target', path, startLine: lines + 1, endLine: lines * 2 }
			],
			signal,
			onTool
		);

		const content = results
			.filter((result) => result.ok)
			.map((result) =>
				result.content
					.split('\n')
					.map((line) => line.replace(/^\d+\|/, ''))
					.join('\n')
			)
			.join('\n');

		if (!content.trim()) return null;

		return {
			content,
			path,
			ref: evidence.revision.targetRef || undefined,
			sha: evidence.revision.targetSha || undefined
		};
	} catch {
		return null;
	}
}

/** Reads the target revision's instruction files and finds paths related to the changed sources. */
async function loadGuidance(
	inventory: ReviewInventory,
	evidence: EvidenceStore,
	signal: AbortSignal,
	onTool?: HarnessEvents['onTool']
): Promise<void> {
	if (!evidence.revision) return;

	await loadInstructionFiles(inventory, evidence, signal, onTool);
	inventory.relatedPaths = await findRelatedPaths(inventory, evidence, signal, onTool);
}

/** The first 80 lines of each instruction file that exists on the target revision. */
async function loadInstructionFiles(
	inventory: ReviewInventory,
	evidence: EvidenceStore,
	signal: AbortSignal,
	onTool?: HarnessEvents['onTool']
): Promise<void> {
	const paths = await evidence.existingFiles('target', INSTRUCTION_PATHS, signal);

	const reads = paths.map((path) => ({
		action: 'readFile' as const,
		revision: 'target',
		path,
		startLine: 1,
		endLine: 80
	}));

	for (let i = 0; i < reads.length; i += REVIEW_POLICY.maxRetrievalsPerTurn) {
		const results = await evidence.executeRound(reads.slice(i, i + REVIEW_POLICY.maxRetrievalsPerTurn), signal, onTool);

		for (const result of results) {
			if (!result.ok || !result.path || !result.content.trim()) continue;

			inventory.instructionFiles.push({
				path: result.path,
				excerpt: result.content.slice(0, 4000),
				truncated: result.truncated
			});
		}
	}
}

/** Paths whose contents mention the base name of one of the first few changed sources or tests. */
async function findRelatedPaths(
	inventory: ReviewInventory,
	evidence: EvidenceStore,
	signal: AbortSignal,
	onTool?: HarnessEvents['onTool']
): Promise<string[]> {
	const related = new Set<string>();

	const sources = inventory.files
		.filter((file) => file.classification === 'source' || file.classification === 'test')
		.slice(0, 5);

	for (const file of sources) {
		const base = file.path
			.split('/')
			.pop()
			?.replace(/\.[^.]+$/, '');

		if (!base || base.length < 3) continue;

		const results = await evidence.executeRound(
			[{ action: 'search', revision: 'target', query: base, prefix: '' }],
			signal,
			onTool
		);

		for (const result of results) {
			if (!result.ok) continue;

			for (const line of result.content.split('\n').slice(0, 8)) {
				const path = line.replace(/^[^:]+:/, '').split(':')[0];

				if (path && path !== file.path) related.add(path);
			}
		}
	}

	return [...related].slice(0, 16);
}
