import { z } from 'zod';

/** One sign-in field of an integration's form. Only text and choice fields map onto Recoder's prompts. */
const fieldSchema = z
	.object({
		key: z.string(),
		type: z.string(),
		title: z.string().optional(),
		description: z.string().optional(),
		placeholder: z.string().optional(),
		options: z.array(z.object({ value: z.string(), label: z.string(), description: z.string().optional() })).optional(),
		when: z.array(z.object({ key: z.string(), op: z.enum(['eq', 'neq']), value: z.unknown() })).optional()
	})
	.passthrough();

const methodSchema = z
	.object({
		type: z.string(),
		id: z.string().optional(),
		label: z.string().optional(),
		form: z.array(z.unknown()).optional()
	})
	.passthrough();

const connectionSchema = z
	.object({ type: z.string(), id: z.string().optional(), label: z.string().optional() })
	.passthrough();

export const integrationSchema = z.object({
	id: z.string(),
	name: z.string(),
	methods: z.array(methodSchema),
	connections: z.array(connectionSchema)
});

export const modelSchema = z
	.object({
		providerID: z.string(),
		modelID: z.string(),
		name: z.string().optional(),
		status: z.string().optional(),
		limit: z.object({ context: z.number().optional() }).partial().optional(),
		capabilities: z.object({ tools: z.boolean().optional() }).partial().optional(),
		variants: z.array(z.object({ id: z.string() })).optional()
	})
	.passthrough();

export type Integration = z.infer<typeof integrationSchema>;

type Method = Integration['methods'][number];

type Model = z.infer<typeof modelSchema>;

/** The methods Recoder can run: a pasted key, or a browser sign-in. Env variables and shell commands are not its to start. */
export function signInMethods(integration: Integration): Method[] {
	return integration.methods.filter((method) => method.type === 'key' || method.type === 'oauth');
}

/** One form field as the prompt shape the v1 catalog reader takes, or nothing for a field type it cannot show. */
function promptOf(raw: unknown): unknown[] {
	const field = fieldSchema.safeParse(raw);

	if (!field.success || field.data.type !== 'string') return [];

	const { key, title, description, placeholder, options, when } = field.data;
	const condition = when?.[0];

	return [
		{
			type: options?.length ? 'select' : 'text',
			key,
			message: title ?? key,
			...(options?.length
				? { options: options.map((o) => ({ label: o.label, value: o.value, hint: o.description })) }
				: { placeholder: placeholder ?? description }),
			...(condition ? { when: { key: condition.key, op: condition.op, value: String(condition.value) } } : {})
		}
	];
}

/** `GET /provider/auth` in its v1 shape: sign-in methods by provider, a key as `api`. */
export function authJson(integrations: Integration[]): Record<string, unknown[]> {
	return Object.fromEntries(
		integrations.map((integration) => [
			integration.id,
			signInMethods(integration).map((method) => ({
				type: method.type === 'key' ? 'api' : 'oauth',
				label: method.label ?? 'API key',
				prompts: (method.form ?? []).flatMap(promptOf)
			}))
		])
	);
}

function modelJson(model: Model): unknown {
	return {
		id: model.modelID,
		name: model.name,
		status: model.status,
		limit: model.limit,
		capabilities: { toolcall: model.capabilities?.tools },
		variants: Object.fromEntries((model.variants ?? []).map((variant) => [variant.id, {}]))
	};
}

/**
 * Where a provider's login came from, in v1's words. A saved credential is a key unless OpenCode labels it a
 * sign-in; a provider with models but no login of its own is configured by the user.
 */
function sourceOf(integration: Integration | undefined): string {
	const connection = integration?.connections[0];

	if (connection?.type === 'env') return 'env';
	if (connection?.type !== 'credential') return 'config';

	return /oauth/i.test(connection.label ?? '') ? 'custom' : 'api';
}

function byProvider(models: Model[]): Map<string, Model[]> {
	const groups = new Map<string, Model[]>();

	for (const model of models) groups.set(model.providerID, [...(groups.get(model.providerID) ?? []), model]);

	return groups;
}

/** `GET /provider` in its v1 shape: every provider with the models it offers. */
export function providersJson(integrations: Integration[], models: Model[]): { all: unknown[] } {
	const grouped = byProvider(models);

	return {
		all: integrations.map(({ id, name }) => ({
			id,
			name,
			models: Object.fromEntries((grouped.get(id) ?? []).map((model) => [model.modelID, modelJson(model)]))
		}))
	};
}

/** `GET /config/providers` in its v1 shape: the providers whose models can be used now. */
export function connectedJson(integrations: Integration[], models: Model[]): { providers: unknown[] } {
	const named = new Map(integrations.map((integration) => [integration.id, integration]));

	return {
		providers: [...byProvider(models)].map(([id, list]) => ({
			id,
			name: named.get(id)?.name ?? id,
			source: sourceOf(named.get(id)),
			models: Object.fromEntries(list.map((model) => [model.modelID, modelJson(model)]))
		}))
	};
}
