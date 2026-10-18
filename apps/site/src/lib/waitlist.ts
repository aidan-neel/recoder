/** The address shape the waitlist table accepts (`db/waitlist.sql` checks the same one). */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The longest address the table stores. */
const MAX_LENGTH = 254;

/**
 * The address as the waitlist stores it, trimmed and lowercase, or null when
 * it is not one the table accepts. The form checks with it before posting and
 * the route checks again, so both agree on what counts as an address.
 */
export function waitlistEmail(raw: unknown): string | null {
	const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';

	return email.length <= MAX_LENGTH && EMAIL.test(email) ? email : null;
}
