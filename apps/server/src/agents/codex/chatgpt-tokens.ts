import { z } from 'zod';
import { LlmError } from '../../models/llm';

export const credentialsSchema = z.object({
	accessToken: z.string().min(1),
	refreshToken: z.string().min(1),
	expiresAt: z.number().finite().positive(),
	accountId: z.string().min(1),
	email: z.string().nullable(),
	planType: z.string().nullable(),
	residency: z.string().optional()
});

export type Credentials = z.infer<typeof credentialsSchema>;

const tokenResponseSchema = z.object({
	access_token: z.string().min(1),
	refresh_token: z.string().min(1).optional(),
	id_token: z.string().optional(),
	expires_in: z.number().finite().positive().optional()
});

/** OpenAI's answer that the refresh token itself is dead (Codex CLI treats the same codes as final). */
const DEAD_REFRESH_CODES = new Set([
	'invalid_grant',
	'refresh_token_expired',
	'refresh_token_reused',
	'refresh_token_invalidated'
]);

/** A plain object's fields, or an empty record for anything else (arrays, primitives, null). */
export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * A JWT's claims, or an empty record when it cannot be read. Only used for
 * metadata from tokens the fixed HTTPS issuer returned, never for an
 * authorization decision based on a browser-supplied JWT.
 */
function claims(token?: string): Record<string, unknown> {
	if (!token) return {};

	try {
		return asRecord(JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()));
	} catch {
		return {};
	}
}

/** The first non-empty string among the values. */
function firstText(...values: unknown[]): string | undefined {
	return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

/** Token expiry: `expires_in` when given, else the access token's `exp`, else an hour from now. */
function expiryOf(expiresIn: number | undefined, exp: unknown, now: number): number {
	if (expiresIn) return now + expiresIn * 1000;
	if (typeof exp === 'number' && Number.isFinite(exp)) return exp * 1000;

	return now + 3600_000;
}

/**
 * Turn an issuer token response into stored credentials. On refresh,
 * `previous` fills in what the issuer left out and must belong to the same account.
 */
export function credentialsFromTokens(raw: unknown, now: number, previous?: Credentials): Credentials {
	const parsed = tokenResponseSchema.safeParse(raw);

	if (!parsed.success) throw new LlmError(502, 'ChatGPT returned an invalid token response. Sign in again.');

	const tokens = parsed.data;
	const access = claims(tokens.access_token);
	const id = claims(tokens.id_token);
	const auth = asRecord(id['https://api.openai.com/auth']);
	const accessAuth = asRecord(access['https://api.openai.com/auth']);
	const profile = asRecord(access['https://api.openai.com/profile']);

	const accountId = firstText(
		auth.chatgpt_account_id,
		id.chatgpt_account_id,
		accessAuth.chatgpt_account_id,
		access.chatgpt_account_id,
		previous?.accountId
	);

	const refreshToken = tokens.refresh_token ?? previous?.refreshToken;

	if (!accountId || !refreshToken)
		throw new LlmError(502, 'ChatGPT sign-in did not return an account and refresh token. Sign in again.');
	if (previous && accountId !== previous.accountId)
		throw new LlmError(401, 'ChatGPT account changed during refresh. Disconnect and sign in again.');

	const residency = firstText(
		accessAuth.chatgpt_compute_residency,
		access.chatgpt_compute_residency,
		previous?.residency
	);

	return {
		accessToken: tokens.access_token,
		refreshToken,
		expiresAt: expiryOf(tokens.expires_in, access.exp, now),
		accountId,
		email: firstText(id.email, access.email, profile.email, previous?.email) ?? null,
		planType: firstText(auth.chatgpt_plan_type, accessAuth.chatgpt_plan_type, previous?.planType) ?? null,
		...(residency && residency !== 'no_constraint' ? { residency } : {})
	};
}

/** The error code in a failed refresh response, as a string or an `{ code }` object. */
async function refreshErrorCode(response: Response): Promise<string | undefined> {
	try {
		const body = asRecord(await response.json());
		const code = typeof body.error === 'string' ? body.error : (asRecord(body.error).code ?? body.code);

		return typeof code === 'string' ? code : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Why a token refresh failed. Only a dead refresh token ends the login; a 403
 * (often a proxy or Cloudflare) or a 5xx is temporary.
 */
export async function refreshFailure(response: Response): Promise<{ dead: boolean; code?: string }> {
	const code = await refreshErrorCode(response);
	const dead = response.status === 401 || (response.status === 400 && !!code && DEAD_REFRESH_CODES.has(code));

	return { dead, code };
}
