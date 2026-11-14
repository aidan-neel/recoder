import type { Context } from 'hono';
import type { z } from 'zod';
import { imageProblem } from '../attachments/image-upload';

/**
 * The JSON body parsed by `schema`, or a 400 with the validation details. A refused image is named in the error,
 * since the person can fix it.
 */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S> | Response> {
	const parsed = schema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success)
		return c.json({ error: imageProblem(parsed.error) ?? 'invalid body', details: parsed.error.flatten() }, 400);

	return parsed.data;
}
