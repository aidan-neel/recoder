import { z } from 'zod';

const object = z.record(z.string(), z.unknown());

/** Merge only user-set OpenCode windows; leave provider options, model limits and unrelated config intact. */
export function openCodeConfigContent(
	content: string | undefined,
	windows: Record<string, number>
): string | undefined {
	const overrides = Object.entries(windows).filter(([id]) => id.startsWith('opencode:') && id.includes('/'));

	if (!overrides.length) return content;

	const config = content ? object.parse(JSON.parse(content)) : {};
	const providers = object.parse(config.provider ?? {});

	for (const [id, context] of overrides) {
		const slash = id.indexOf('/');
		const providerId = id.slice('opencode:'.length, slash);
		const modelId = id.slice(slash + 1);
		const provider = object.parse(providers[providerId] ?? {});
		const models = object.parse(provider.models ?? {});
		const model = object.parse(models[modelId] ?? {});
		const limit = object.parse(model.limit ?? {});

		models[modelId] = { ...model, limit: { ...limit, context } };
		providers[providerId] = { ...provider, models };
	}

	return JSON.stringify({ ...config, provider: providers });
}
