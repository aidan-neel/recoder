import type { SignInForge, SignInMethod } from '@recoder/shared';
import { z } from 'zod';
import { oauthClientId, oauthClientSecret } from '../env';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_SECONDS = 5;
const GITHUB_SCOPE = 'repo read:user read:org';
const GITLAB_SCOPE = 'api read_user';

/** Where a forge's OAuth and API endpoints live. `host` is GitLab's self-managed host; null for github.com and gitlab.com. */
export interface ForgeTarget {
	provider: SignInForge;
	host: string | null;
}

/** What the forge hands back for a device sign-in: the code the person enters, and the one Recoder polls with. */
export interface DeviceCodeGrant {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	expiresInSeconds: number;
	intervalSeconds: number;
}

/** An access token with its optional refresh half. GitLab's expire after about two hours. */
export interface IssuedToken {
	accessToken: string;
	refreshToken: string | null;
	expiresAt: string | null;
}

/** One answer to a token poll. `slow-down` carries the interval the forge now asks for, when it names one. */
export type TokenPoll =
	| { kind: 'pending' }
	| { kind: 'slow-down'; intervalSeconds: number | null }
	| { kind: 'expired' }
	| { kind: 'denied' }
	| { kind: 'granted'; token: IssuedToken };

/** What the browser carries to the forge's authorize page, and back to the callback. */
export interface AuthorizationRequest {
	state: string;
	/** The S256 challenge of the verifier the callback will send. */
	codeChallenge: string;
	redirectUri: string;
}

/** What the callback trades for a token. */
export interface AuthorizationGrant {
	code: string;
	codeVerifier: string;
	redirectUri: string;
}

/** The person on the forge: `remoteId` is stable across renames, so accounts match on it, not on `login`. */
export interface ForgeUser {
	remoteId: string;
	login: string;
	name: string | null;
	avatarUrl: string | null;
}

/**
 * A forge call that failed. `message` is fixed text safe to show: it never carries a response body, a token or a
 * code. `reason` says what kind of failure it was.
 */
export class ForgeOAuthError extends Error {
	constructor(
		message: string,
		readonly reason: 'unconfigured' | 'busy' | 'unreachable' | 'rejected' | 'invalid-grant' | 'unexpected'
	) {
		super(message);
		this.name = 'ForgeOAuthError';
	}
}

const deviceCodeSchema = z.object({
	device_code: z.string().min(1),
	user_code: z.string().min(1),
	verification_uri: z.string().min(1),
	expires_in: z.number().positive(),
	interval: z.number().positive().optional()
});

const tokenResponseSchema = z.object({
	access_token: z.string().min(1).optional(),
	refresh_token: z.string().min(1).optional(),
	expires_in: z.number().positive().optional(),
	error: z.string().optional(),
	interval: z.number().positive().optional()
});

const userSchema = z.object({
	id: z.union([z.number(), z.string()]),
	login: z.string().optional(),
	username: z.string().optional(),
	name: z.string().nullish(),
	avatar_url: z.string().nullish()
});

/** How a forge signs people in: a redirect needs the client id and secret, the device flow the id alone, and with no id there is no sign-in. */
export function signInMethod(provider: SignInForge): SignInMethod | null {
	if (!oauthClientId(provider)) return null;

	return oauthClientSecret(provider) ? 'redirect' : 'device';
}

/** Where the browser goes to authorize Recoder: the forge's authorize page, with PKCE and the same scopes as the device flow. */
export function authorizationUrl(target: ForgeTarget, request: AuthorizationRequest): string {
	const { base, clientId, scope } = oauthEndpoints(target);
	const url = new URL(target.provider === 'github' ? '/login/oauth/authorize' : '/oauth/authorize', base);

	url.search = new URLSearchParams({
		client_id: clientId,
		redirect_uri: request.redirectUri,
		response_type: 'code',
		scope,
		state: request.state,
		code_challenge: request.codeChallenge,
		code_challenge_method: 'S256'
	}).toString();

	return url.href;
}

/** Trades the code the forge sent the callback for a token, proving the secret and the PKCE verifier. */
export async function exchangeAuthorizationCode(
	target: ForgeTarget,
	grant: AuthorizationGrant,
	now: number
): Promise<IssuedToken> {
	const { base, clientId } = oauthEndpoints(target);
	const clientSecret = oauthClientSecret(target.provider);

	if (!clientSecret) {
		throw new ForgeOAuthError(
			`Sign in with ${target.provider} by redirect is not set up on this server.`,
			'unconfigured'
		);
	}

	const path = target.provider === 'github' ? '/login/oauth/access_token' : '/oauth/token';

	const response = await postForm(base + path, {
		client_id: clientId,
		client_secret: clientSecret,
		code: grant.code,
		code_verifier: grant.codeVerifier,
		redirect_uri: grant.redirectUri,
		grant_type: 'authorization_code'
	});

	return grantedToken(await readJson(response), now);
}

/** Step one of the device flow: ask the forge for a user code and a device code. */
export async function requestDeviceCode(target: ForgeTarget): Promise<DeviceCodeGrant> {
	const { base, clientId, scope } = oauthEndpoints(target);
	const path = target.provider === 'github' ? '/login/device/code' : '/oauth/authorize_device';
	const response = await postForm(base + path, { client_id: clientId, scope });
	const body = await readJson(response);

	if (!response.ok) {
		throw new ForgeOAuthError(`${new URL(base).host} refused to start the sign-in (${response.status}).`, 'rejected');
	}

	const parsed = deviceCodeSchema.safeParse(body);

	if (!parsed.success) throw new ForgeOAuthError('The forge sent an unexpected sign-in answer.', 'unexpected');

	return {
		deviceCode: parsed.data.device_code,
		userCode: parsed.data.user_code,
		verificationUri: verificationPage(parsed.data.verification_uri, base),
		expiresInSeconds: parsed.data.expires_in,
		intervalSeconds: parsed.data.interval ?? DEFAULT_POLL_SECONDS
	};
}

/** Step two: one poll. GitHub answers pending states with 200 and GitLab with 400, so the body decides, not the status. */
export async function pollDeviceToken(target: ForgeTarget, deviceCode: string, now: number): Promise<TokenPoll> {
	const { base, clientId } = oauthEndpoints(target);
	const path = target.provider === 'github' ? '/login/oauth/access_token' : '/oauth/token';

	const response = await postForm(base + path, {
		client_id: clientId,
		device_code: deviceCode,
		grant_type: DEVICE_GRANT
	});

	return interpretTokenAnswer(await readJson(response), now);
}

/** Trades a GitLab refresh token for a new pair. The old refresh token stops working the moment this succeeds. */
export async function refreshAccessToken(target: ForgeTarget, refreshToken: string, now: number): Promise<IssuedToken> {
	const { base, clientId } = oauthEndpoints(target);

	const clientSecret = oauthClientSecret('gitlab');

	const response = await postForm(`${base}/oauth/token`, {
		client_id: clientId,
		...(clientSecret ? { client_secret: clientSecret } : {}),
		refresh_token: refreshToken,
		grant_type: 'refresh_token'
	});

	return grantedToken(await readJson(response), now);
}

/** The person a token belongs to, read from the forge's user endpoint. */
export async function fetchForgeUser(target: ForgeTarget, accessToken: string): Promise<ForgeUser> {
	const response = await send(userUrl(target), {
		headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
	});

	if (!response.ok) throw new ForgeOAuthError(`The forge refused the token (${response.status}).`, 'rejected');

	return parseForgeUser(await readJson(response));
}

/** A forge user endpoint's JSON (GitHub's and GitLab's share the fields read here) as a `ForgeUser`. */
export function parseForgeUser(body: unknown): ForgeUser {
	const parsed = userSchema.safeParse(body);
	const login = parsed.success ? (parsed.data.login ?? parsed.data.username) : undefined;

	if (!parsed.success || !login) throw new ForgeOAuthError('The forge sent an unexpected profile.', 'unexpected');

	return {
		remoteId: String(parsed.data.id),
		login,
		name: parsed.data.name?.trim() || null,
		avatarUrl: parsed.data.avatar_url?.startsWith('https://') ? parsed.data.avatar_url : null
	};
}

/** The device flow endpoints, or a `ForgeOAuthError` when the forge has no client id set. */
function oauthEndpoints(target: ForgeTarget): { base: string; clientId: string; scope: string } {
	const clientId = oauthClientId(target.provider);

	if (!clientId) {
		throw new ForgeOAuthError(`Sign in with ${target.provider} is not set up on this server.`, 'unconfigured');
	}

	if (target.provider === 'github') return { base: 'https://github.com', clientId, scope: GITHUB_SCOPE };

	return { base: `https://${target.host ?? 'gitlab.com'}`, clientId, scope: GITLAB_SCOPE };
}

function userUrl(target: ForgeTarget): string {
	if (target.provider === 'github') return 'https://api.github.com/user';

	return `https://${target.host ?? 'gitlab.com'}/api/v4/user`;
}

/** One request with a deadline. A transport failure becomes a typed error that names the host only, never a query or body. */
async function send(url: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	} catch {
		throw new ForgeOAuthError(`Could not reach ${new URL(url).host}.`, 'unreachable');
	}
}

function postForm(url: string, fields: Record<string, string>): Promise<Response> {
	return send(url, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(fields)
	});
}

async function readJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		throw new ForgeOAuthError('The forge sent an answer Recoder could not read.', 'unexpected');
	}
}

/** The verification page, resolved against the forge's base (GitLab may send a path) and held to https. */
function verificationPage(uri: string, base: string): string {
	const url = new URL(uri, base);

	if (url.protocol !== 'https:') {
		throw new ForgeOAuthError('The forge sent a verification address that is not https.', 'unexpected');
	}

	return url.href;
}

/** Maps a token endpoint answer to a poll result; an error code the device flow does not define fails the sign-in. */
function interpretTokenAnswer(body: unknown, now: number): TokenPoll {
	const parsed = tokenResponseSchema.safeParse(body);

	if (!parsed.success) throw new ForgeOAuthError('The forge sent an unexpected token answer.', 'unexpected');

	const { error, access_token: accessToken } = parsed.data;

	if (error === 'authorization_pending') return { kind: 'pending' };
	if (error === 'slow_down') return { kind: 'slow-down', intervalSeconds: parsed.data.interval ?? null };
	if (error === 'expired_token' || error === 'token_expired') return { kind: 'expired' };
	if (error === 'access_denied') return { kind: 'denied' };

	if (error === 'device_flow_disabled') {
		throw new ForgeOAuthError('Device flow is not enabled for this OAuth application.', 'rejected');
	}

	if (error === 'invalid_grant')
		throw new ForgeOAuthError('The forge no longer accepts this sign-in.', 'invalid-grant');
	if (error || !accessToken) throw new ForgeOAuthError('The forge did not issue a token.', 'rejected');

	return { kind: 'granted', token: issuedToken(parsed.data, accessToken, now) };
}

/** The token a token endpoint answer issued; any other answer (a pending poll, a refusal) is an error here. */
function grantedToken(body: unknown, now: number): IssuedToken {
	const answer = interpretTokenAnswer(body, now);

	if (answer.kind !== 'granted') throw new ForgeOAuthError('The forge did not issue a token.', 'rejected');

	return answer.token;
}

function issuedToken(answer: z.infer<typeof tokenResponseSchema>, accessToken: string, now: number): IssuedToken {
	return {
		accessToken,
		refreshToken: answer.refresh_token ?? null,
		expiresAt: answer.expires_in ? new Date(now + answer.expires_in * 1000).toISOString() : null
	};
}
