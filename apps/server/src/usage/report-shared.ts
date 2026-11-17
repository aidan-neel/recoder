import { Hono } from 'hono';
import { DEFAULT_USAGE_DAYS, USAGE_DAYS, type ReportPerson, type UsageDays } from '@recoder/shared';
import { listMembers } from '../accounts/members';

const DAY_MS = 24 * 60 * 60 * 1000;

/** An ISO timestamp's UTC calendar date (`YYYY-MM-DD`), or null when `iso` does not parse. */
export function utcDay(iso: string): string | null {
	const at = Date.parse(iso);

	return Number.isNaN(at) ? null : new Date(at).toISOString().slice(0, 10);
}

/** The `count` UTC calendar dates ending on `now`'s UTC date, oldest first. */
export function windowDayKeys(now: Date, count: number): string[] {
	const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const keys: string[] = [];

	for (let back = count - 1; back >= 0; back--) {
		keys.push(new Date(today - back * DAY_MS).toISOString().slice(0, 10));
	}

	return keys;
}

/** Groups `items` into arrays keyed by `keyOf(item)`, preserving insertion order. */
export function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();

	for (const item of items) {
		const key = keyOf(item);
		const list = groups.get(key);

		if (list) list.push(item);
		else groups.set(key, [item]);
	}

	return groups;
}

/** The median of `values`, rounded to a whole number; null when there are none. */
export function medianOf(values: readonly number[]): number | null {
	const sorted = [...values].sort((a, b) => a - b);

	if (sorted.length === 0) return null;

	const middle = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;

	return Math.round(median);
}

/** `part / whole`, or 0 when `whole` is 0. */
export function shareOf(part: number, whole: number): number {
	return whole === 0 ? 0 : part / whole;
}

/**
 * Who an account that no longer exists was, from its id (`member:<provider>:<host>:<login>`), so a removed member's
 * history still shows under their name. An id that does not read that way is shown as it is.
 */
function removedAccount(accountId: string): ReportPerson {
	const [, provider, ...rest] = accountId.split(':');
	const login = rest.pop();
	const isForge = provider === 'github' || provider === 'gitlab';

	if (!accountId.startsWith('member:') || !isForge || !login) {
		return { accountId, role: 'member', provider: 'github', host: null, login: accountId };
	}

	return { accountId, role: 'member', provider, host: rest.join(':') || null, login };
}

/** Every known account plus synthesized entries for removed accounts referenced in `seenIds`. */
export function allReportPeople(known: readonly ReportPerson[], seenIds: Iterable<string>): ReportPerson[] {
	const identities = new Map(known.map((person) => [person.accountId, person]));

	for (const accountId of seenIds) {
		if (!identities.has(accountId)) identities.set(accountId, removedAccount(accountId));
	}

	return [...identities.values()];
}

/** The admin and every member who has not been removed. */
export async function loadReportPeople(): Promise<ReportPerson[]> {
	return (await listMembers()).map((member) => ({
		accountId: member.key,
		role: member.role,
		provider: member.provider,
		host: member.host,
		login: member.login,
		...(member.avatarUrl ? { avatarUrl: member.avatarUrl } : {})
	}));
}

/** A `GET /?days=7|30|90` Hono route that validates `days` and responds with `load(days)`. */
export function daysReportRoute<Report>(load: (days: UsageDays) => Promise<Report>): Hono {
	const app = new Hono();

	app.get('/', async (c) => {
		const asked = c.req.query('days');
		const days = asked === undefined ? DEFAULT_USAGE_DAYS : USAGE_DAYS.find((window) => String(window) === asked);

		if (days === undefined) return c.json({ error: `Pass days as one of ${USAGE_DAYS.join(', ')}.` }, 400);

		return c.json(await load(days));
	});

	return app;
}
