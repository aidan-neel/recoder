import { neon } from '@neondatabase/serverless';

import { waitlistEmail } from '~/lib/waitlist';

/** An answer with a fixed message. A database error is never echoed, so a response can't leak the connection or schema. */
function refuse(status: number, error: string): Response {
	return Response.json({ error }, { status });
}

/**
 * Adds `{ email }` to the hosted waitlist in Neon. Joining twice still answers
 * 200, so the response never reveals who is already on the list. The database
 * address is read per request, so a deploy without one answers 503.
 */
export async function POST(request: Request): Promise<Response> {
	const body: unknown = await request.json().catch(() => null);
	const email = waitlistEmail(body && typeof body === 'object' && 'email' in body ? body.email : null);

	if (!email) return refuse(400, 'Enter a valid email address');

	const url = process.env.DATABASE_URL;

	if (!url) return refuse(503, 'Waitlist is not configured');

	try {
		const sql = neon(url);

		await sql`insert into waitlist (email) values (${email}) on conflict (email) do nothing`;
	} catch {
		return refuse(500, 'Could not join the waitlist');
	}

	return Response.json({ ok: true });
}
