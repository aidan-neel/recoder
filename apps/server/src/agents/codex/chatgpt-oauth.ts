import { z } from 'zod';
import { LlmError } from '../../models/llm';

/**
 * Public OAuth client and device flow used by Codex/OpenCode. No client secret.
 * Protocol: openai/codex, codex-rs/login/src/device_code_auth.rs.
 */
const ISSUER = 'https://auth.openai.com';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

/** Where the user enters the device code. */
export const VERIFICATION_URL = `${ISSUER}/codex/device`;

/** A request to the issuer, bounded by the caller's lifecycle and timeout. */
export type IssuerRequest = (url: string, init: RequestInit) => Promise<Response>;

/** A device code the user still has to enter. */
export interface DeviceCode {
	userCode: string;
	deviceAuthId: string;
	intervalMs: number;
}

const userCodeSchema = z.object({
	device_auth_id: z.string().min(1),
	user_code: z.string().optional(),
	usercode: z.string().optional(),
	interval: z.union([z.string(), z.number()]).optional()
});

const authorizationSchema = z.object({ authorization_code: z.string().min(1), code_verifier: z.string().min(1) });

/** A response's JSON body, failing with a user-safe message when it is not JSON. */
export async function readBody(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		throw new LlmError(502, 'ChatGPT returned an invalid response. Try again.');
	}
}

/** The issuer's poll interval in milliseconds, defaulting to five seconds. */
function pollInterval(interval: string | number | undefined): number {
	const seconds = Number(interval);

	return (Number.isFinite(seconds) && seconds > 0 ? Math.max(1, seconds) : 5) * 1000;
}

/** POST a form to the issuer's token endpoint. */
export function tokenRequest(request: IssuerRequest, form: Record<string, string>): Promise<Response> {
	return request(`${ISSUER}/oauth/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: CLIENT_ID, ...form }).toString()
	});
}

/** Ask the issuer for a new device code. */
export async function requestDeviceCode(request: IssuerRequest): Promise<DeviceCode> {
	const response = await request(`${ISSUER}/api/accounts/deviceauth/usercode`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ client_id: CLIENT_ID })
	});

	if (!response.ok) {
		await response.body?.cancel();
		throw new LlmError(
			response.status,
			response.status === 404
				? 'Device sign-in is unavailable. Enable device-code authorization in your ChatGPT security settings and try again.'
				: `Could not start ChatGPT sign-in (HTTP ${response.status}). Try again.`
		);
	}

	const parsed = userCodeSchema.safeParse(await readBody(response));
	const userCode = parsed.success ? parsed.data.user_code || parsed.data.usercode : undefined;

	if (!parsed.success || !userCode) throw new LlmError(502, 'ChatGPT did not return a sign-in code. Try again.');

	return { userCode, deviceAuthId: parsed.data.device_auth_id, intervalMs: pollInterval(parsed.data.interval) };
}

/** Ask the issuer whether the user has entered the device code yet. */
export function pollDeviceCode(request: IssuerRequest, code: DeviceCode): Promise<Response> {
	return request(`${ISSUER}/api/accounts/deviceauth/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ device_auth_id: code.deviceAuthId, user_code: code.userCode })
	});
}

/** Exchange an approved poll's authorization code for the issuer's token response. */
export async function exchangeAuthorization(request: IssuerRequest, approved: Response): Promise<unknown> {
	const parsed = authorizationSchema.safeParse(await readBody(approved));

	if (!parsed.success) throw new LlmError(502, 'ChatGPT returned an invalid authorization code. Start sign-in again.');

	const exchange = await tokenRequest(request, {
		grant_type: 'authorization_code',
		redirect_uri: `${ISSUER}/deviceauth/callback`,
		code: parsed.data.authorization_code,
		code_verifier: parsed.data.code_verifier
	});

	if (!exchange.ok) {
		await exchange.body?.cancel();
		throw new LlmError(
			exchange.status,
			`ChatGPT token exchange failed (HTTP ${exchange.status}). Start sign-in again.`
		);
	}

	return readBody(exchange);
}
