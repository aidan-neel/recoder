import { z } from 'zod';
import type { Finding, FindingSeverity } from '@recoder/shared';
import type { EvidenceStore } from './evidence.js';
import type { ReviewInventory } from './inventory.js';
import type { SpecialistFinding } from './specialist.js';
import type { ReviewRole } from './roles.js';

const toBackendSeverity: Record<string, FindingSeverity> = {
	high: 'error',
	medium: 'warning',
	low: 'info',
	info: 'info'
};

export interface CandidateFinding extends Finding {
	candidateId: string;
	valid: boolean;
	dropReason?: string;
}

export const consolidationSchema = z.object({
	message: z.string().max(12000).optional(),
	keep: z.array(z.string()).max(80).default([]),
	merge: z
		.array(
			z.object({
				keepId: z.string(),
				mergeIds: z.array(z.string()).max(20),
				body: z.string().max(2000).optional()
			})
		)
		.max(40)
		.default([]),
	reject: z.array(z.object({ id: z.string(), reason: z.string().max(400) })).max(80).default([]),
	recommendedChecks: z.array(z.string().max(400)).max(20).default([])
});

export type ConsolidationPlan = z.infer<typeof consolidationSchema>;

export function consolidationSystemPrompt(): string {
	return `You consolidate Recoder specialist candidates into confirmed findings.
You may keep, merge, clarify, or reject candidates. You cannot invent findings or evidence.
Do not drop an issue solely because a previous review reported it.
Do not merge distinct issues that happen to share a file or line.
Output STRICT JSON: {"message":string,"keep":[candidateId],"merge":[{"keepId","mergeIds","body?"}],"reject":[{"id","reason"}],"recommendedChecks":[string]}
Every candidate id must appear in keep, merge, or reject.`;
}

export function consolidationUserPrompt(candidates: CandidateFinding[], evidence: EvidenceStore): string {
	const lines = candidates.map((candidate) => {
		const loc = candidate.side === 'old' ? `${candidate.file}${candidate.line ? `:${candidate.line}` : ''} (old)` : `${candidate.file}${candidate.line ? `:${candidate.line}` : ''}`;
		return `${candidate.candidateId} [${candidate.agent}/${candidate.assignmentId}] ${candidate.severity} ${loc}\n${candidate.message}\nevidence: ${(candidate.evidenceIds ?? []).join(', ') || '(none)'}`;
	});
	const cited = new Set(candidates.flatMap((candidate) => candidate.evidenceIds ?? []));
	const records = [...evidence.records.values()].filter((record) => cited.has(record.id));
	const perRecord = Math.max(200, Math.floor(32_000 / Math.max(1, records.length)));
	const evidenceNotes = records
		.map((record) => `${record.id} ${record.revision} ${record.path}:${record.startLine}-${record.endLine}\nUNTRUSTED EVIDENCE:\n${record.content.slice(0, perRecord)}${record.content.length > perRecord ? '\n[excerpt truncated; do not assume omitted content]' : ''}`)
		.join('\n');
	return `Candidates:\n${lines.join('\n\n')}\n\nEvidence index:\n${evidenceNotes || '(none)'}`;
}

export function validateCandidate(
	raw: SpecialistFinding,
	meta: { candidateId: string; assignmentId: string; role: ReviewRole; model: string; fingerprint: (file: string, category: string, start: number, end: number, side: 'old' | 'new') => string },
	inventory: ReviewInventory,
	evidence: EvidenceStore
): CandidateFinding {
	const candidateId = meta.candidateId;
	const file = inventory.files.find((entry) => entry.path === raw.file);
	const side: 'old' | 'new' = raw.side === 'old' ? 'old' : 'new';
	const line = raw.line ?? undefined;
	const endLine = raw.endLine && line && raw.endLine >= line ? raw.endLine : line;
	const provided = evidence.providedIds();
	const evidenceIds = (raw.evidenceIds ?? []).filter((id) => provided.has(id));
	let dropReason: string | undefined;
	if (!file) dropReason = 'path is not in the change inventory';
	else if (file.excludeReason) dropReason = `path is excluded (${file.excludeReason})`;
	else if (side === 'new' && line) {
		if (!newSideAnchored(inventory, file.path, line)) dropReason = 'new-side line is not associated with this change';
	} else if (side === 'new' && !line && file.status !== 'deleted') {
		dropReason = 'file-level finding on a non-deleted file needs a line';
	}
	if (!dropReason && (raw.evidenceIds ?? []).length > 0 && evidenceIds.length === 0) {
		dropReason = 'cited evidence was not provided';
	}
	const finding: CandidateFinding = {
		id: crypto.randomUUID(),
		candidateId,
		file: raw.file,
		line,
		endLine,
		severity: toBackendSeverity[raw.severity],
		message: `[${raw.category}] ${raw.body}`,
		agent: meta.role,
		model: meta.model,
		assignmentId: meta.assignmentId,
		category: raw.category,
		evidenceIds,
		relatedLocations: raw.relatedLocations,
		side,
		fingerprint: meta.fingerprint(raw.file, raw.category, line ?? 0, endLine ?? line ?? 0, side),
		valid: !dropReason,
		dropReason
	};
	return finding;
}

function newSideAnchored(inventory: ReviewInventory, path: string, line: number): boolean {
	const file = inventory.diffs.find((entry) => entry.path === path);
	if (!file) return false;
	for (const hunk of file.hunks) {
		for (const entry of hunk.lines) {
			if (entry.newNo === line) return true;
		}
		if (line >= hunk.newStart && line < hunk.newStart + Math.max(hunk.newCount, 1)) return true;
	}
	return false;
}

export function applyConsolidation(
	plan: ConsolidationPlan,
	candidates: CandidateFinding[]
): { confirmed: Finding[]; rejected: Array<{ id: string; reason: string }> } {
	const byId = new Map(candidates.filter((candidate) => candidate.valid).map((candidate) => [candidate.candidateId, candidate]));
	const consumed = new Set<string>();
	const confirmed: Finding[] = [];
	const rejected: Array<{ id: string; reason: string }> = [];

	for (const merge of plan.merge) {
		const keep = byId.get(merge.keepId);
		if (!keep || consumed.has(merge.keepId)) continue;
		const related = [...(keep.relatedLocations ?? [])];
		for (const id of merge.mergeIds) {
			const extra = byId.get(id);
			if (!extra) continue;
			consumed.add(id);
			related.push({ file: extra.file, line: extra.line, endLine: extra.endLine, side: extra.side });
			related.push(...(extra.relatedLocations ?? []));
		}
		consumed.add(merge.keepId);
		confirmed.push({
			...keep,
			message: merge.body ? `[${keep.category ?? 'issue'}] ${merge.body}` : keep.message,
			relatedLocations: related
		});
	}

	for (const id of plan.keep) {
		if (consumed.has(id)) continue;
		const candidate = byId.get(id);
		if (!candidate) continue;
		consumed.add(id);
		confirmed.push(candidate);
	}

	for (const item of plan.reject) {
		if (consumed.has(item.id)) continue;
		consumed.add(item.id);
		rejected.push(item);
	}

	for (const candidate of byId.values()) {
		if (consumed.has(candidate.candidateId)) continue;
		rejected.push({ id: candidate.candidateId, reason: 'omitted from consolidation output' });
	}

	return { confirmed, rejected };
}

export function deterministicConsolidate(candidates: CandidateFinding[]): {
	confirmed: Finding[];
	rejected: Array<{ id: string; reason: string }>;
} {
	const confirmed: Finding[] = [];
	const rejected: Array<{ id: string; reason: string }> = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate.valid) {
			rejected.push({ id: candidate.candidateId, reason: candidate.dropReason ?? 'invalid candidate' });
			continue;
		}
		const key = candidate.fingerprint ?? candidate.candidateId;
		if (seen.has(key)) {
			rejected.push({ id: candidate.candidateId, reason: 'duplicate of an earlier candidate' });
			continue;
		}
		seen.add(key);
		confirmed.push(candidate);
	}
	return { confirmed, rejected };
}
