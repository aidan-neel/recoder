import { z } from 'zod';
import type { DiffGuide, DiffGuideGroup } from '@recoder/shared';

export const guideReplySchema = z.object({
	groups: z
		.array(
			z.object({
				title: z.string().trim().min(1).max(160),
				explanation: z.string().trim().min(1).max(800),
				hunks: z
					.array(z.object({ id: z.string().max(2000), explanation: z.string().trim().min(1).max(400) }))
					.max(10000)
			})
		)
		.max(10000)
});

/** First known assignment wins; missing and pure-move entries retain their seed group and trusted metadata. */
export function normalizeDiffGuide(raw: unknown, seed: DiffGuide): DiffGuide | null {
	const parsed = guideReplySchema.safeParse(raw);

	if (!parsed.success) return null;

	const known = new Map(seed.groups.flatMap((group) => group.hunks.map((hunk) => [hunk.id, hunk] as const)));
	const seen = new Set<string>();
	const groups: DiffGuideGroup[] = [];

	for (const [index, group] of parsed.data.groups.entries()) {
		const hunks = group.hunks.flatMap((entry) => {
			const hunk = known.get(entry.id);

			if (!hunk || hunk.note || seen.has(entry.id)) return [];

			seen.add(entry.id);

			return [{ ...hunk, explanation: entry.explanation }];
		});

		if (hunks.length)
			groups.push({ id: `model-${index + 1}`, title: group.title, explanation: group.explanation, hunks });
	}

	for (const group of seed.groups) {
		const hunks = group.hunks.filter((hunk) => !seen.has(hunk.id));

		if (hunks.length) groups.push({ ...group, hunks });
	}

	return { source: groups.some((group) => group.id.startsWith('model-')) ? 'model' : 'deterministic', groups };
}
