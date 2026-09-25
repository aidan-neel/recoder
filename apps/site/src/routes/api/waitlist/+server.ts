import { neon } from '@neondatabase/serverless';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

/** Runs as a Vercel function; everything else on the site is prerendered. */
export const prerender = false;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Adds `{ email }` to the hosted waitlist. Joining twice is a no-op that still
 * answers 200, so the response never reveals who is already on the list.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!env.DATABASE_URL) error(503, 'Waitlist is not configured');

	const body: unknown = await request.json().catch(() => null);
	const raw = body && typeof body === 'object' && 'email' in body ? body.email : null;
	const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
	if (email.length > 254 || !EMAIL.test(email)) error(400, 'Enter a valid email address');

	const sql = neon(env.DATABASE_URL);
	await sql`insert into waitlist (email) values (${email}) on conflict (email) do nothing`;
	return json({ ok: true });
};
