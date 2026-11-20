import type { ChangeGroup, PullDescription } from '@recoder/shared';
import { extractJsonValue } from '../../models/json-extract';

const MAX_GROUPS = 8;

type DescriptionCopy = Pick<PullDescription, 'summary' | 'groups' | 'notes'>;

/** Bad model output is a recoverable failure, never an unhandled parse exception. */
export function normalizeDescription(output: string, changedPaths: readonly string[]): DescriptionCopy | null {
	let response: Record<string, unknown> | undefined;

	try {
		response = object(extractJsonValue(output));
	} catch {
		return null;
	}

	const summary = text(response?.summary);

	if (!summary) return null;

	const changed = new Set(changedPaths);
	const remaining = new Set(changed);
	const groups: Omit<ChangeGroup, 'id'>[] = [];

	for (const raw of array(response?.groups)) {
		const group = object(raw);
		const title = text(group?.title).replace(/\.+$/, '').trimEnd();
		const note = text(group?.note);
		const explanation = text(group?.explanation);

		if (!title || !note || !explanation) continue;

		const paths = array(group?.paths).flatMap((path) => {
			if (typeof path !== 'string') return [];

			const exact = changed.has(path) ? path : path.trim();

			return remaining.delete(exact) ? [exact] : [];
		});

		if (paths.length) groups.push({ title, note, explanation, paths });
	}

	const keep = MAX_GROUPS - Number(remaining.size > 0);
	const overflow = groups.splice(keep);

	if (overflow.length) groups[keep - 1].paths.push(...overflow.flatMap(({ paths }) => paths));

	if (remaining.size) {
		groups.push({
			title: 'Other changes',
			note: 'Files the description did not group.',
			explanation: 'These files changed in this pull request but were not included in the groups above.',
			paths: [...remaining]
		});
	}

	return {
		summary,
		groups: groups.map((group, index) => ({ id: `g${index + 1}`, ...group })),
		notes: array(response?.notes).map(text).filter(Boolean).slice(0, 4)
	};
}

function object(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function array(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}
