import { resolve4, resolve6 } from 'node:dns/promises';
import { connect as tlsConnect } from 'node:tls';
import type { DnsCheck, SetupAddress, TlsStatus } from '@recoder/shared';
import { caddyAdminUrl, publicAddresses, publicOrigin, tlsOff } from '../../env';
import { readDeploymentState, updateDeploymentState, type StoredAddress } from './state';

/** What the diagnostics and the checklist read: the address the server is published at, and its TLS. */
export type AddressStatus = { publicUrl: string | null; tls: TlsStatus };

/** What a live probe of the domain's HTTPS port saw. */
interface TlsProbe {
	issuer?: string;
	/** The certificate's `notAfter`, as a date the server can parse. */
	expiresAt: string;
}

/** How the address module reaches the world; every seam is replaced in tests. */
export interface AddressDeps {
	now: () => number;
	probeTls: (domain: string) => Promise<TlsProbe>;
	resolveDns: (domain: string) => Promise<string[]>;
	loadCaddy: (config: string) => Promise<void>;
}

/** How long Caddy has to produce a certificate before the address step reports `failed`. */
const PENDING_LIMIT_MS = 15 * 60_000;

/** How often the pending certificate is probed; the UI polls every second, a handshake every half minute. */
const PROBE_THROTTLE_MS = 30_000;

/** An issued certificate is trusted until it is this close to expiring, then it is probed again. */
const REPROBE_MARGIN_MS = 14 * 24 * 60 * 60_000;

/** The parts of the real world, each overridable in tests. */
export function realDeps(): AddressDeps {
	return { now: () => Date.now(), probeTls: probeTlsReal, resolveDns: resolveDnsReal, loadCaddy: loadCaddyReal };
}

/**
 * The address the diagnostics and the checklist show: a stored configuration wins (`external` names a proxy,
 * a `domain` is Caddy's), then `RECODER_PUBLIC_URL` (Helm and proxies that were set by hand), then nothing.
 */
export async function readAddressStatus(deps: AddressDeps = realDeps()): Promise<AddressStatus> {
	const stored = (await readDeploymentState())?.address;

	if (stored?.domain) return { publicUrl: stored.publicUrl, tls: await tlsStatus(stored, deps) };

	if (stored?.external) {
		return { publicUrl: stored.publicUrl, tls: { state: 'external', domain: hostnameOf(stored.publicUrl) } };
	}

	const externalUrl = publicOrigin();

	if (externalUrl) return { publicUrl: externalUrl, tls: { state: 'external', domain: hostnameOf(externalUrl) } };

	return { publicUrl: null, tls: { state: 'off', domain: null } };
}

/**
 * `GET /api/setup/address`: the full state of the address step, with the DNS check once a domain was given.
 * `reachedAt` is the address this request came in on, which the route computes from the request itself.
 */
export async function readSetupAddress(reachedAt: string, deps: AddressDeps = realDeps()): Promise<SetupAddress> {
	const stored = (await readDeploymentState())?.address;
	const status = await readAddressStatus(deps);

	return { reachedAt, ...status, dns: stored?.domain ? await dnsCheck(stored.domain, deps) : undefined };
}

/** The outcome of `POST /api/setup/address`: the address as it now stands, or why it could not be set. */
export type SetAddressResult = { address: StoredAddress } | { error: string };

/**
 * `POST /api/setup/address` with a domain: point Caddy at it and ask for a certificate. The TLS state answers
 * `pending` while Caddy works; the GET polls until it is `issued` or `failed`.
 */
export async function setDomainAddress(domain: string, deps: AddressDeps = realDeps()): Promise<SetAddressResult> {
	const name = normalizeDomain(domain);

	if (!name) return { error: 'Enter a domain name, like recoder.example.com.' };

	if (tlsOff()) {
		return {
			error:
				'This install runs with TLS off (RECODER_TLS=off). Put your own proxy in front and set its address instead.'
		};
	}

	const found = await deps.resolveDns(name);

	if (found.length === 0) {
		return { error: `${name} does not resolve yet. Point its DNS at this server first.` };
	}

	const expected = publicAddresses();

	if (expected.length > 0 && !found.some((address) => expected.includes(address))) {
		return {
			error: `${name} resolves to ${joinAddresses(found)}, which does not include this server (${joinAddresses(expected)}). Point its DNS here first.`
		};
	}

	try {
		await deps.loadCaddy(caddyfileForDomain(name));
	} catch (error) {
		return {
			error: `Could not ask Caddy for a certificate: ${error instanceof Error ? error.message : String(error)}`
		};
	}

	const address: StoredAddress = { publicUrl: `https://${name}`, domain: name, requestedAt: deps.now() };

	await updateDeploymentState((state) => ({ ...state, address }));

	return { address };
}

/**
 * `POST /api/setup/address` with a proxy's address: everything about TLS is the proxy's job, so Recoder keeps
 * the URL and reports `external` from now on.
 */
export async function setExternalAddress(url: string): Promise<SetAddressResult> {
	const parsed = URL.parse(url.trim());

	if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.hostname === '') {
		return { error: 'Enter the address people reach this server at, like https://recoder.example.com.' };
	}

	const address: StoredAddress = { publicUrl: parsed.origin, external: true };

	await updateDeploymentState((state) => ({ ...state, address }));

	return { address };
}

/** Where Caddy serves the site and how Recoder's stream of events stays unbuffered through it. */
function caddyfileForDomain(domain: string): string {
	return [
		'{',
		'\tadmin :2019',
		'}',
		`https://${domain} {`,
		'\treverse_proxy recoder-server:3001 {',
		'\t\tflush_interval -1',
		'\t}',
		'}',
		''
	].join('\n');
}

async function tlsStatus(stored: StoredAddress, deps: AddressDeps): Promise<TlsStatus> {
	const domain = stored.domain ?? '';
	const now = deps.now();

	if (tlsOff()) return { state: 'off', domain };

	const issued = stored.issued;
	const fresh = issued !== undefined && Date.parse(issued.expiresAt) - now > REPROBE_MARGIN_MS;

	if (fresh) return { state: 'issued', domain, issuer: issued.issuer, expiresAt: issued.expiresAt };

	if (now - (stored.probedAt ?? 0) < PROBE_THROTTLE_MS) {
		if (issued) return { state: 'issued', domain, issuer: issued.issuer, expiresAt: issued.expiresAt };

		return pendingOrFailed(stored, domain, now);
	}

	try {
		const probe = await deps.probeTls(domain);

		await updateDeploymentState((state) => ({
			...state,
			address: state.address && { ...state.address, probedAt: now, issued: { ...probe, seenAt: now } }
		}));

		return { state: 'issued', domain, issuer: probe.issuer, expiresAt: probe.expiresAt };
	} catch {
		await updateDeploymentState((state) => ({
			...state,
			address: state.address && { ...state.address, probedAt: now }
		}));

		if (issued && Date.parse(issued.expiresAt) > now) {
			return { state: 'issued', domain, issuer: issued.issuer, expiresAt: issued.expiresAt };
		}

		return pendingOrFailed(stored, domain, now);
	}
}

function pendingOrFailed(stored: StoredAddress, domain: string, now: number): TlsStatus {
	if (now - (stored.requestedAt ?? 0) > PENDING_LIMIT_MS) {
		return { state: 'failed', domain, error: `No certificate for ${domain} appeared within 15 minutes.` };
	}

	return { state: 'pending', domain };
}

async function dnsCheck(domain: string, deps: AddressDeps): Promise<DnsCheck> {
	const expected = publicAddresses();
	const found = await deps.resolveDns(domain).catch(() => []);

	return {
		domain,
		points: expected.length > 0 && found.some((address) => expected.includes(address)),
		found,
		expected
	};
}

/** A domain a person can type: letters, digits, dots and dashes, lowercased, no scheme, no path, at most 253. */
function normalizeDomain(domain: string): string | null {
	const name = domain.trim().toLowerCase().replace(/\.$/, '');

	return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(name) && name.length <= 253
		? name
		: null;
}

function hostnameOf(url: string): string {
	return new URL(url).hostname;
}

function joinAddresses(addresses: string[]): string {
	return addresses.map((address) => address || '?').join(', ');
}

/** The TLS handshake a real probe makes: the certificate's issuer and expiry, or a rejection. */
async function probeTlsReal(domain: string): Promise<TlsProbe> {
	return new Promise((resolve, reject) => {
		const socket = tlsConnect({ host: domain, servername: domain, port: 443 }, () => {
			const certificate = socket.getPeerCertificate();

			socket.end();

			if (!certificate || !certificate.valid_to) {
				reject(new Error('the server answered without a certificate.'));

				return;
			}

			resolve({ issuer: issuerName(certificate), expiresAt: new Date(certificate.valid_to).toISOString() });
		});

		const fail = (error: Error) => {
			socket.destroy();
			reject(error);
		};

		socket.once('error', fail);
		socket.once('timeout', () => fail(new Error('the server did not complete the TLS handshake in 5 seconds.')));
		socket.setTimeout(5_000);
	});
}

function issuerName(certificate: { issuer?: { CN?: string | string[]; O?: string | string[] } }): string | undefined {
	const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

	return first(certificate.issuer?.CN) ?? first(certificate.issuer?.O);
}

async function resolveDnsReal(domain: string): Promise<string[]> {
	const answers = await Promise.allSettled([resolve4(domain), resolve6(domain)]);

	return answers.flatMap((answer) => (answer.status === 'fulfilled' ? answer.value : []));
}

/** Loads a Caddyfile into Caddy through its admin API, replacing whatever config it runs now. */
async function loadCaddyReal(config: string): Promise<void> {
	const response = await fetch(new URL('/load', caddyAdminUrl()), {
		method: 'POST',
		headers: { 'content-type': 'text/caddyfile' },
		body: config,
		signal: AbortSignal.timeout(10_000)
	});

	if (!response.ok) {
		const detail = (await response.text()).slice(0, 200);

		throw new Error(`Caddy answered ${response.status}${detail ? `: ${detail}` : ''}`);
	}
}
