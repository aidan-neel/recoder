import type { ModelEntry, ReasoningEffort } from '@recoder/shared';
import { z } from 'zod';

const ANTIGRAVITY_MODEL_PREFIX = 'antigravity:';

const GEMINI_CONTEXT_WINDOW = 1_000_000;

const DEFAULT_CONTEXT_WINDOW = 200_000;

const EFFORT_ORDER: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const DEFAULT_GEMINI_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high'];

const EFFORT_SUFFIX = /^(.+)-(low|medium|high|xhigh|max)$/;

const LABEL_SUFFIX = /^(.+?)\s*\((Low|Medium|High|Xhigh|Max)\)$/i;

/** JSON envelope emitted by `agy --output-format json models`. */
const modelsEnvelopeSchema = z.object({
	status: z.string(),
	command: z
		.object({
			name: z.literal('models'),
			data: z.object({
				models: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
			})
		})
		.optional()
});

interface RawModel {
	id: string;
	label: string;
}

interface SplitVariant {
	base: string;
	baseLabel: string;
	effort: ReasoningEffort;
}

function isEffort(value: string): value is ReasoningEffort {
	return EFFORT_ORDER.some((effort) => effort === value);
}

/** Splits an effort-suffixed model (`gemini-4-carbon-high` / `Gemini 4 Carbon (High)`) into its family and level. */
function splitVariant(raw: RawModel): SplitVariant | null {
	const idMatch = EFFORT_SUFFIX.exec(raw.id);
	const labelMatch = LABEL_SUFFIX.exec(raw.label);

	if (!idMatch || !labelMatch) return null;

	const [, base, effort] = idMatch;
	const [, baseLabel, labelEffort] = labelMatch;

	if (!base || !effort || !baseLabel || !labelEffort) return null;
	if (effort !== labelEffort.toLowerCase() || !isEffort(effort)) return null;

	return { base, baseLabel: baseLabel.trim(), effort };
}

function contextWindowFor(model: string): number {
	return model.startsWith('gemini-') ? GEMINI_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW;
}

function toModelEntry(
	model: string,
	label: string,
	efforts?: ReasoningEffort[],
	defaultEffort?: ReasoningEffort
): ModelEntry {
	return {
		id: `${ANTIGRAVITY_MODEL_PREFIX}${model}`,
		provider: 'antigravity',
		label,
		model,
		baseUrl: null,
		apiKeySet: false,
		contextWindow: contextWindowFor(model),
		...(efforts && defaultEffort ? { efforts, defaultEffort } : {})
	};
}

/**
 * Parses `agy --output-format json models` into Recoder's model list. Families listed with two or more effort
 * variants (`gemini-4-carbon-{medium,high,low}`) collapse into one base model (`gemini-4-carbon`) whose default
 * effort is the first variant the CLI listed; single-variant models (`gpt-oss-120b-medium`, `claude-sonnet-4-6`)
 * keep their exact slug without an effort selector.
 */
export function parseAntigravityModels(output: string): ModelEntry[] {
	let parsedJson: unknown;

	try {
		parsedJson = JSON.parse(output);
	} catch {
		return [];
	}

	const envelope = modelsEnvelopeSchema.safeParse(parsedJson);

	if (!envelope.success || envelope.data.status !== 'SUCCESS') return [];

	const rawModels = envelope.data.command?.data.models ?? [];
	const familyCounts = new Map<string, number>();

	for (const item of rawModels) {
		const variant = splitVariant(item);

		if (variant) familyCounts.set(variant.base, (familyCounts.get(variant.base) ?? 0) + 1);
	}

	const entries: ModelEntry[] = [];
	const grouped = new Map<string, { label: string; first: ReasoningEffort; levels: Set<ReasoningEffort> }>();
	const order: Array<{ kind: 'single'; raw: RawModel } | { kind: 'family'; base: string }> = [];

	for (const item of rawModels) {
		const variant = splitVariant(item);

		if (!variant || (familyCounts.get(variant.base) ?? 0) < 2) {
			order.push({ kind: 'single', raw: item });
			continue;
		}

		const existing = grouped.get(variant.base);

		if (existing) {
			existing.levels.add(variant.effort);
			continue;
		}

		grouped.set(variant.base, {
			label: variant.baseLabel,
			first: variant.effort,
			levels: new Set([variant.effort])
		});

		order.push({ kind: 'family', base: variant.base });
	}

	for (const slot of order) {
		if (slot.kind === 'single') {
			entries.push(toModelEntry(slot.raw.id, slot.raw.label));
			continue;
		}

		const family = grouped.get(slot.base);

		if (!family) continue;

		const efforts = EFFORT_ORDER.filter((level) => family.levels.has(level));

		entries.push(toModelEntry(slot.base, family.label, efforts, family.first));
	}

	return entries;
}

/**
 * Effort levels and default for `model`. Uses the catalog `models()` fetched when available, and falls back to the
 * standard Gemini levels for unsuffixed `gemini-*` families resolved before the first catalog read.
 */
export function antigravityEfforts(
	model: string,
	known: ReadonlyMap<string, ModelEntry>
): Pick<ModelEntry, 'efforts' | 'defaultEffort'> {
	const cached = known.get(model);

	if (cached) {
		return cached.efforts && cached.defaultEffort
			? { efforts: cached.efforts, defaultEffort: cached.defaultEffort }
			: {};
	}

	if (model.startsWith('gemini-') && !EFFORT_SUFFIX.test(model)) {
		return { efforts: DEFAULT_GEMINI_EFFORTS, defaultEffort: 'high' };
	}

	return {};
}

/** `--effort <level>` when `model` accepts `reasoningEffort`, otherwise empty. */
export function effortArgs(
	model: string,
	reasoningEffort: ReasoningEffort | undefined,
	known: ReadonlyMap<string, ModelEntry>
): string[] {
	const offered = antigravityEfforts(model, known).efforts;

	return reasoningEffort && offered?.includes(reasoningEffort) ? ['--effort', reasoningEffort] : [];
}
