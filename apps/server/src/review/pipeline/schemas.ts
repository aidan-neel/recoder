import { z } from 'zod';
import { REVIEW_ROLES } from './roles.js';
import { REVIEW_POLICY } from '../session/review-policy.js';

/** Shortens an over-long string to `max` characters, ending in an ellipsis; anything else passes through. */
export function clip(value: unknown, max: number): unknown {
	return typeof value === 'string' && value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * The fields every assignment carries, planned or proposed as a specialist's
 * follow-up. Callers set how strict a hunk id is and how many files a scope may list.
 */
export function assignmentShape(hunkId: z.ZodString, maxScope: number) {
	return {
		id: z.string().min(1).max(80),
		role: z.enum(REVIEW_ROLES),
		title: z.string().min(1).max(200),
		reason: z.string().min(1).max(1000),
		scope: z
			.array(
				z.object({
					path: z.string().min(1).max(500),
					hunkIds: z.array(hunkId).max(80)
				})
			)
			.min(1)
			.max(maxScope)
	};
}

/** The fields every model-reported finding carries; callers choose which severities are accepted. */
export function findingShape<S extends z.ZodType>(severity: S) {
	return {
		title: z.string().trim().min(1).max(120).optional(),
		file: z.string().min(1).max(500),
		line: z.number().int().positive().nullable().optional(),
		endLine: z.number().int().positive().nullable().optional(),
		severity,
		category: z.string().min(1).max(50),
		body: z.string().min(1).max(2000)
	};
}

const READ_ACTIONS = ['readDiff', 'readFile', 'search', 'listFiles'];
const EXEC_ACTIONS = [...READ_ACTIONS, 'run', 'writeFile'];

/**
 * A retrieval turn for endpoints with guided decoding: a message and at least
 * one action. With `exec`, actions may also run commands and write files.
 */
export function retrievalTurnSchema(exec: boolean): Record<string, unknown> {
	const str = { type: 'string' };

	const action = {
		type: 'object',
		properties: {
			action: { type: 'string', enum: exec ? EXEC_ACTIONS : READ_ACTIONS },
			revision: { type: 'string', enum: ['head', 'target', 'mergeBase'] },
			path: str,
			query: str,
			prefix: str,
			cursor: str,
			hunkIds: { type: 'array', items: str },
			startLine: { type: 'integer' },
			endLine: { type: 'integer' },
			...(exec ? { command: str, content: str, timeoutSec: { type: 'integer' } } : {})
		},
		required: ['action']
	};

	return {
		type: 'object',
		properties: {
			message: str,
			actions: { type: 'array', items: action, minItems: 1, maxItems: REVIEW_POLICY.maxRetrievalsPerTurn }
		},
		required: ['message', 'actions'],
		additionalProperties: false
	};
}
