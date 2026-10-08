import { z } from 'zod';
import type { EvidenceRecord, EvidenceStore } from '../../../evidence/evidence.js';
import { clip, retrievalTurnSchema } from '../schemas.js';

const MAX_CITED = 12;

const workerOutputSchema = z.object({
	message: z.string().max(4000).optional(),
	answer: z.string().trim().min(1).max(3000),
	evidence: z
		.array(z.object({ evidenceId: z.string().trim().min(1).max(40), note: z.string().max(300).default('') }))
		.max(MAX_CITED)
		.default([]),
	unresolved: z.string().trim().max(600).nullable().default(null)
});

export type WorkerOutput = z.infer<typeof workerOutputSchema>;

/** A minimal valid answer, quoted back when the worker gets the shape wrong. */
export const WORKER_EXAMPLE =
	'{"message":"Found two callers.","answer":"`acquire` has two callers: `src/pool.ts:41` releases on error, `src/job.ts:88` does not.","evidence":[{"evidenceId":"E3","note":"job.ts:80-95, no finally"}],"unresolved":null}';

/** The answer shape, for the worker's system prompt. */
export const WORKER_SHAPE = `When finished, output STRICT JSON:
{"message":string,"answer":string,"evidence":[{"evidenceId":string,"note":string}],"unresolved":string|null}
"answer" is short plain text with the facts the task asked for, each with file:line. "evidence" lists the evidence ids from your tool results that back the answer, with one short note each. "unresolved" says what you could not find or run, or null.`;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** `"E3"` as a cited item, the way models often write one. */
function citedItem(item: unknown): unknown {
	if (typeof item === 'string') return { evidenceId: item, note: '' };
	if (!isRecord(item)) return item;

	return { ...item, evidenceId: item.evidenceId ?? item.id, note: clip(item.note ?? '', 300) };
}

/** Clips over-long text and accepts bare evidence ids, so validation only fails an answer that is really missing. */
function repair(raw: unknown): unknown {
	if (!isRecord(raw)) return raw;

	const evidence = Array.isArray(raw.evidence) ? raw.evidence.slice(0, MAX_CITED).map(citedItem) : raw.evidence;

	return {
		...raw,
		answer: clip(raw.answer, 3000),
		evidence,
		unresolved: typeof raw.unresolved === 'string' && !raw.unresolved.trim() ? null : clip(raw.unresolved, 600)
	};
}

export function parseWorkerOutput(raw: unknown): WorkerOutput | null {
	const parsed = workerOutputSchema.safeParse(repair(raw));

	return parsed.success ? parsed.data : null;
}

export function workerValidationError(raw: unknown): string {
	const parsed = workerOutputSchema.safeParse(repair(raw));

	return parsed.success
		? ''
		: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'answer'}: ${issue.message}`).join('; ');
}

/** A worker turn for endpoints with guided decoding: a retrieval request, or the answer; only the answer on the final turn. */
export function workerResponseSchema(
	exec: boolean,
	finalTurn: boolean
): { name: string; schema: Record<string, unknown> } {
	const str = { type: 'string' };

	const final = {
		type: 'object',
		properties: {
			message: str,
			answer: str,
			evidence: {
				type: 'array',
				maxItems: MAX_CITED,
				items: { type: 'object', properties: { evidenceId: str, note: str }, required: ['evidenceId', 'note'] }
			},
			unresolved: { type: ['string', 'null'] }
		},
		required: ['message', 'answer', 'evidence', 'unresolved']
	};

	return {
		name: finalTurn ? 'worker_result' : 'worker_turn',
		schema: finalTurn ? final : { anyOf: [retrievalTurnSchema(exec), final] }
	};
}

/** Where a record came from, in one line: the command and its exit code, or the file and lines read. */
function recordLine(record: EvidenceRecord): string {
	if (record.kind === 'run') return `run \`${record.command ?? ''}\` exit ${record.exitCode ?? 'none'}`;

	return `${record.path}:${record.startLine}-${record.endLine} (${record.revision})`;
}

/**
 * The worker's answer as the delegating reviewer reads it. The answer is the
 * worker's summary, so the reviewer is told to cite the records under it.
 * Ids the worker cited that no record has are dropped.
 */
export function workerReport(output: WorkerOutput, evidence: EvidenceStore, model: string): string {
	const cited = output.evidence.flatMap(({ evidenceId, note }) => {
		const record = evidence.get(evidenceId);

		return record ? [`- ${evidenceId}: ${recordLine(record)}${note.trim() ? `. ${note.trim()}` : ''}`] : [];
	});

	return [
		`Worker answer from ${model}. It is a summary, not evidence: cite the evidence ids below, and read them when the answer decides a finding.`,
		output.answer,
		cited.length ? `Evidence:\n${cited.join('\n')}` : 'Evidence: none cited.',
		output.unresolved ? `Unresolved: ${output.unresolved}` : ''
	]
		.filter(Boolean)
		.join('\n\n');
}
