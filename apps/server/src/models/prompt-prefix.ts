import { createHash } from 'node:crypto';
import type { ModelCallRow } from '@recoder/shared';

/** Fingerprints only Recoder-controlled prompt text; no prompt content enters telemetry. */
export function promptPrefix(tools: string, system: string, opening: string): NonNullable<ModelCallRow['prefix']> {
	const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

	return { tools: hash(tools), system: hash(system), opening: hash(opening) };
}
