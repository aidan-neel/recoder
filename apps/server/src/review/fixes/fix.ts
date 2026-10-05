import { z } from 'zod';
import { describeFinding, findingRequestSchema } from '../chat/finding-request.js';
import { readExcerpt } from '../pipeline/harness.js';
import { capDiff } from '../pipeline/prompts.js';
import { asLlmError, chatCompletion, LlmError } from '../../models/llm.js';
import { configForAgent, type ModelConfig } from '../../models/models.js';
import { sampling } from '../../models/runtime-profiles.js';
import { EditMismatchError, patchFromEdits } from './fix-edits.js';

export { locateEdit, patchFromEdits } from './fix-edits.js';
export { patchApplies } from './patch-check.js';

/**
 * Prompt for on-demand fix suggestions. The model returns find-and-replace edits, never a diff:
 * the server applies them to the real file and builds the patch itself (`fix-edits.ts`).
 */
const SYSTEM_PROMPT = `You write minimal code fixes for a single review finding. You cannot run commands or see anything outside the provided finding, file excerpt, and diff.
Fix only the reported finding. Keep the change minimal: no refactors, no unrelated changes, no new files.
Output STRICT JSON: {"summary": string, "edits": [{"file": string, "find": string, "replace": string}]}.
- "summary" is one short sentence describing the change.
- "file" is the repo-relative path.
- "find" is text copied verbatim from the current file (without the "12: " line-number prefixes), including indentation, with enough whole lines to match exactly once.
- "replace" is the full text that takes the place of "find".
No prose outside the JSON object.`;

/** Sent after a reply hits the output limit; the retry also turns thinking off. */
const TRUNCATED_NUDGE =
	'Your reply hit the output limit. Answer now without deliberating: one or two small edits, each "find" only the few lines that change, JSON only.';

/** Output budget per reply. Thinking counts against it on reasoning models, and 4k was often spent before any JSON. */
const FIX_MAX_TOKENS = 16_000;

const NO_JSON = 'no JSON object in model output';

const editSchema = z.object({
	file: z.string().min(1).max(500),
	find: z.string().min(1).max(20000),
	replace: z.string().max(20000)
});

const fixEditsSchema = z.array(editSchema).min(1).max(12);

const fixOutputSchema = z.object({
	summary: z.string().min(1).max(500),
	edits: fixEditsSchema
});

export const suggestFixRequestSchema = z.object({
	agent: z.string().min(1).max(50),
	finding: findingRequestSchema
});

export interface SuggestFixInput {
	agent: string;
	file: string;
	line: number;
	endLine: number;
	severity: string;
	message: string;
	diff: string;
	sandboxPath: string;
}

/** A written fix: what it does and the patch. */
interface FixDraft {
	summary: string;
	patch: string;
}

/** A fix plus the role and model that wrote it. */
type SuggestedFix = FixDraft & { agent: string; model: string };

/** Pull a JSON object out of model output (tolerates fences/prose). */
function extractJsonObject(output: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output);
	const candidate = fenced ? fenced[1] : output;
	const start = candidate.indexOf('{');
	const end = candidate.lastIndexOf('}');

	if (start === -1 || end <= start) throw new Error(NO_JSON);

	return JSON.parse(candidate.slice(start, end + 1));
}

/** A reply cut off at the output limit. Reasoning models hit this while thinking, so it is worth one retry without. */
function isOutputTruncated(err: unknown): boolean {
	return err instanceof LlmError && /output truncated/i.test(err.message);
}

/** Failures that mean the reply was not a usable fix, so the model gets another try. */
function isUnusableReply(err: unknown): err is Error {
	return (
		err instanceof EditMismatchError || err instanceof SyntaxError || (err instanceof Error && err.message === NO_JSON)
	);
}

/** Turn a reply into a fix, or say why it can't be used. */
async function readFixReply(output: string, sandboxPath: string): Promise<FixDraft | { problem: string }> {
	try {
		const parsed = fixOutputSchema.safeParse(extractJsonObject(output));

		if (!parsed.success) throw new EditMismatchError('the reply was not {"summary", "edits"} JSON');

		const patch = await patchFromEdits(sandboxPath, parsed.data.edits);

		return { summary: parsed.data.summary.trim(), patch };
	} catch (err) {
		if (!isUnusableReply(err)) throw err;

		return { problem: err.message };
	}
}

/** Ask for edits, build the patch from them, and give the model one more try when they don't land. */
async function writeFix(cfg: ModelConfig, system: string, user: string, sandboxPath: string): Promise<FixDraft> {
	const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	];

	let thinking: boolean | undefined;

	try {
		for (let attempt = 1; ; attempt++) {
			let output: string;

			try {
				output = await chatCompletion({
					...cfg,
					messages,
					...sampling(cfg, FIX_MAX_TOKENS),
					thinking,
					timeoutMs: 180_000
				});
			} catch (err) {
				if (thinking === false || !isOutputTruncated(err)) throw err;
				thinking = false;
				attempt--;
				messages.push({ role: 'user', content: TRUNCATED_NUDGE });

				continue;
			}

			const reply = await readFixReply(output, sandboxPath);

			if (!('problem' in reply)) return reply;

			if (attempt >= 2) throw new LlmError(0, 'The model could not write a fix that matches the code. Try again.');

			messages.push(
				{ role: 'assistant', content: output },
				{
					role: 'user',
					content: `That fix could not be used: ${reply.problem}. Copy "find" verbatim from the file and reply with the JSON again.`
				}
			);
		}
	} catch (err) {
		throw asLlmError(err);
	}
}

/** A fix for one review finding, written from the finding, the code around it and the PR diff. */
export async function suggestFix(input: SuggestFixInput): Promise<SuggestedFix> {
	const cfg = configForAgent(input.agent);
	const parts = [describeFinding(input)];
	const span = Math.max(0, input.endLine - input.line);

	const excerpt = await readExcerpt(
		input.sandboxPath,
		input.file,
		input.line + Math.floor(span / 2),
		Math.max(40, Math.ceil(span / 2) + 25),
		16000
	);

	if (excerpt !== null) parts.push(`--- ${input.file} (current, numbered) ---\n${excerpt}`);

	parts.push(`--- unified diff (capped) ---\n${capDiff(input.diff)}`);

	return {
		agent: input.agent,
		model: cfg.model,
		...(await writeFix(cfg, SYSTEM_PROMPT, parts.join('\n\n'), input.sandboxPath))
	};
}
