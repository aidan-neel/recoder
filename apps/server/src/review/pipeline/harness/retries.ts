import type { ReviewAssignment } from '@recoder/shared';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import type { ReviewUnit, UnitScope } from '../units.js';
import { orchestratorSays } from './context.js';
import type { HarnessEvents } from './types.js';

export interface FailedUnit {
	/** The failed unit, re-scoped under a `retry-` id (two when its scope was split). */
	unit: ReviewUnit;
	error: string;
	/** What the retry does differently, in a few words, for the orchestrator's note. */
	remedy: string;
}

/** Failures that would repeat exactly: a cancelled review, a request the endpoint rejects outright. */
const UNRETRYABLE = /cancel|aborted|unauthori[sz]ed|forbidden|invalid api key|\bLLM 4(?:0[0-9]|1[0-9])\b/i;

/** Failures from doing too much in one go: the retry gets half the scope each. */
const TOO_BIG =
	/truncated|output limit|context length|maximum context|too many tokens|prompt is too long|deadline|ran out of time/i;

/** How the retry should behave differently, given how the first attempt failed. */
function retryAdvice(error: string): { advice: string; remedy: string } {
	if (/only a message|expected array|schema|not valid JSON|no JSON|neither a retrieval/i.test(error)) {
		return {
			remedy: 'with a strict reply format',
			advice:
				'The first attempt failed because its replies had no "actions" and no final result. Every reply must be either {"message", "actions": [...]} to read code, or the final result JSON with "findings" and "examinedHunks".'
		};
	}

	if (/final turn requested retrieval/i.test(error)) {
		return {
			remedy: 'finishing on its last turn',
			advice:
				'The first attempt asked for more code on its final turn. When told it is the final turn, finish with the result.'
		};
	}

	if (TOO_BIG.test(error)) {
		return {
			remedy: 'split in two',
			advice:
				'The first attempt ran out of room or time on a larger scope. Keep replies short and read only what the change needs.'
		};
	}

	return { remedy: 'as is', advice: '' };
}

/**
 * Units whose reviewer ended in an error, as retries. Each unit is retried
 * once, told how the first attempt failed; one that failed from size is split
 * into two halves of its hunks.
 */
export function failedUnits(
	units: ReviewUnit[],
	records: ReviewAssignment[],
	maxRetries: number = REVIEW_POLICY.maxRetryUnits
): FailedUnit[] {
	return units
		.flatMap((unit) => {
			const record = records.find((entry) => entry.id === unit.id);

			if (record?.status !== 'error' || unit.id.startsWith('retry-')) return [];

			const error = (record.currentOperation || 'Reviewer failed').slice(0, 400);

			if (UNRETRYABLE.test(error) && !TOO_BIG.test(error)) return [];

			const hunks = unit.scope.flatMap((entry) => entry.hunkIds.map((hunkId) => ({ path: entry.path, hunkId })));

			if (!TOO_BIG.test(error) || hunks.length < 2) return [retryOf(unit, error, unit.scope)];

			const half = Math.ceil(hunks.length / 2);

			return [
				retryOf(unit, error, regroup(hunks.slice(0, half)), '-a'),
				retryOf(unit, error, regroup(hunks.slice(half)), '-b')
			];
		})
		.slice(0, maxRetries);
}

/** A retry of `unit` over `scope`, whose reason carries how the first attempt failed. */
function retryOf(unit: ReviewUnit, error: string, scope: UnitScope, suffix = ''): FailedUnit {
	const { advice, remedy } = retryAdvice(error);

	return {
		unit: {
			...unit,
			id: `retry-${unit.id}${suffix}`,
			scope,
			reason: `${unit.reason}\n\nRetry: the first attempt failed (${error}). ${advice}`.trim()
		},
		error,
		remedy
	};
}

/** Groups hunks back into per-file scope entries. */
function regroup(hunks: { path: string; hunkId: string }[]): UnitScope {
	return [...new Set(hunks.map((hunk) => hunk.path))].map((path) => ({
		path,
		hunkIds: hunks.filter((hunk) => hunk.path === path).map((hunk) => hunk.hunkId)
	}));
}

/** The orchestrator's note on what failed and how each retry differs. */
export function reportRetries(retries: FailedUnit[], events: HarnessEvents | undefined): void {
	const byOriginal = new Map<string, FailedUnit[]>();

	for (const retry of retries) {
		const key = retry.unit.id.replace(/-[ab]$/, '');

		byOriginal.set(key, [...(byOriginal.get(key) ?? []), retry]);
	}

	const lines = [...byOriginal.values()].map(
		(parts) =>
			`- **${parts[0].unit.title}**: ${parts[0].error.replace(/\s+/g, ' ').slice(0, 140)}. Rerunning ${parts.length > 1 ? 'split in two' : parts[0].remedy}.`
	);

	orchestratorSays(
		events,
		`message_retries_${retries[0].unit.id}`,
		`${byOriginal.size === 1 ? 'One unit' : `${byOriginal.size} units`} failed, so I'm reviewing ${byOriginal.size === 1 ? 'it' : 'them'} again:\n\n${lines.join('\n')}`
	);
}
