import { normalizeGlob } from '../../chat/directive.js';

/**
 * A model-written glob in the form the detectors match with (`*.ts` → `**\/*.ts`),
 * or undefined when it covers every file or Bun can't parse it.
 */
export function cleanGlob(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;

	const glob = normalizeGlob(raw);

	if (!glob || glob.length > 200) return undefined;

	try {
		new Bun.Glob(glob).match('');

		return glob;
	} catch {
		return undefined;
	}
}
