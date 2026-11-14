import { z } from 'zod';
import { REASONING_EFFORTS } from '@recoder/shared';

/** Hidden model ids, deduplicated and sorted; the route drops the ones the server does not list. */
export const hiddenModelsSchema = z
	.array(z.string().min(1).max(200))
	.max(5000)
	.transform((ids) => [...new Set(ids)].sort());

/** The models members run on when the admin enforces them; each id is checked against the server's models by the route. */
const modelPicksSchema = {
	orchestratorModelId: z.string().max(100).nullable(),
	orchestratorEffort: z.enum(REASONING_EFFORTS).nullable(),
	specialistModelId: z.string().max(100).nullable(),
	specialistEffort: z.enum(REASONING_EFFORTS).nullable()
};

export const modelPicksPatchSchema = z.object(modelPicksSchema).partial().strict();

export const modelPolicySchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('choose') }),
	z.object({ kind: z.literal('enforced'), ...modelPicksSchema })
]);
