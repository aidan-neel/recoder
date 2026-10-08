import { z } from 'zod';

const CONTRACT_KINDS = ['type', 'test', 'doc', 'intent', 'source'] as const;

const text = (max: number) => z.string().trim().max(max);

/**
 * The places an answer read its contract or traced the code, as an obligation
 * investigator (#66) and a reviewer settling a brief question both give them.
 */
export const contractEvidenceSchema = z
	.array(z.object({ kind: z.enum(CONTRACT_KINDS), location: text(300), note: text(600) }))
	.max(8)
	.default([]);

/** The input an answer tried, the run it cites by evidence id, and what it observed; null when it ran nothing. */
export const counterexampleSchema = z
	.object({ input: text(600), evidenceId: z.string().nullable().default(null), observed: text(1000) })
	.nullable()
	.default(null);

const str = { type: 'string' };

/** `contractEvidenceSchema` for guided decoding. */
export const CONTRACT_EVIDENCE_RESPONSE = {
	type: 'array',
	items: {
		type: 'object',
		properties: { kind: { type: 'string', enum: [...CONTRACT_KINDS] }, location: str, note: str },
		required: ['kind', 'location', 'note']
	}
};

/** `counterexampleSchema` for guided decoding. */
export const COUNTEREXAMPLE_RESPONSE = {
	type: ['object', 'null'],
	properties: { input: str, evidenceId: { type: ['string', 'null'] }, observed: str },
	required: ['input', 'observed']
};
