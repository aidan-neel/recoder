import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readDeploymentState, updateDeploymentState, type StoredAddress } from '../../../src/deploy/setup/state';
import {
	readSetupAddress,
	realDeps,
	setDomainAddress,
	setExternalAddress,
	type AddressDeps
} from '../../../src/deploy/setup/address';
import { collection } from '../../../src/storage/backend';
import { useTempStore } from '../../helpers/temp-store';

useTempStore('recoder-address-');

/** The variables the tests switch, saved before each and restored after, so none leaks into another file. */
const SWITCHED = ['RECODER_PUBLIC_IPS', 'RECODER_TLS', 'RECODER_PUBLIC_URL'] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
	for (const key of SWITCHED) saved.set(key, process.env[key]);
});

afterEach(() => {
	for (const [key, value] of saved) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}

	saved.clear();
});

const DOMAIN = 'recoder.example.com';
const PROXY = 'https://recoder-behind-proxy.example.com';

const NOW = Date.parse('2026-11-20T18:00:00Z');

afterEach(async () => {
	await collection('update_state').clear();
});

function deps(overrides: Partial<AddressDeps> = {}): AddressDeps {
	return {
		now: () => NOW,
		probeTls: async () => ({ issuer: "Let's Encrypt", expiresAt: '2027-02-20T18:00:00.000Z' }),
		resolveDns: async () => ['203.0.113.7'],
		loadCaddy: async () => undefined,
		...overrides
	};
}

test('a domain is stored as pending and the certificate request reaches Caddy', async () => {
	let loaded = '';

	const result = await setDomainAddress(DOMAIN, deps({ loadCaddy: async (config) => void (loaded = config) }));

	if ('error' in result) throw new Error(result.error);

	expect(result.address).toEqual({ publicUrl: `https://${DOMAIN}`, domain: DOMAIN, requestedAt: NOW });
	expect(loaded).toContain(`https://${DOMAIN}`);
	expect(loaded).toContain('reverse_proxy recoder-server:3001');
	expect(loaded).toContain('flush_interval -1');

	const answer = await readSetupAddress(
		'https://10.0.0.1',
		deps({ probeTls: async () => Promise.reject(new Error('not yet')) })
	);

	expect(answer.tls.state).toBe('pending');
	expect(answer.publicUrl).toBe(`https://${DOMAIN}`);
	expect(answer.dns?.domain).toBe(DOMAIN);
});

test('a domain that resolves nowhere is refused and nothing is stored', async () => {
	const result = await setDomainAddress(DOMAIN, deps({ resolveDns: async () => [] }));

	expect('error' in result && result.error).toContain('does not resolve yet');
	expect((await readDeploymentState())?.address).toBeUndefined();
});

test('a domain that points elsewhere is refused when the server knows its own addresses', async () => {
	process.env.RECODER_PUBLIC_IPS = '198.51.100.1';

	try {
		const result = await setDomainAddress(DOMAIN, deps());

		expect('error' in result && result.error).toContain('does not include this server');
	} finally {
		delete process.env.RECODER_PUBLIC_IPS;
	}
});

test('a domain that points at this server is accepted', async () => {
	process.env.RECODER_PUBLIC_IPS = '198.51.100.1, 203.0.113.7';

	try {
		const result = await setDomainAddress(DOMAIN, deps());

		expect('error' in result).toBe(false);
	} finally {
		delete process.env.RECODER_PUBLIC_IPS;
	}
});

test('a name that is not a domain is refused', async () => {
	expect('error' in (await setDomainAddress('https://recoder.example.com', deps()))).toBe(true);
	expect('error' in (await setDomainAddress('', deps()))).toBe(true);
	expect('error' in (await setDomainAddress('a'.repeat(254), deps()))).toBe(true);
});

test('a proxy that already terminates TLS is stored as external', async () => {
	const result = await setExternalAddress(`${PROXY}/setup`);

	if ('error' in result) throw new Error(result.error);

	expect(result.address).toEqual({ publicUrl: PROXY, external: true });

	const answer = await readSetupAddress('https://10.0.0.1', deps());

	expect(answer.tls).toEqual({ state: 'external', domain: 'recoder-behind-proxy.example.com' });
	expect(answer.dns).toBeUndefined();
});

test('a pending certificate becomes issued once the probe sees it, and stays issued while fresh', async () => {
	await setDomainAddress(DOMAIN, deps());

	const issued = await readSetupAddress('https://10.0.0.1', deps());

	expect(issued.tls).toEqual({
		state: 'issued',
		domain: DOMAIN,
		issuer: "Let's Encrypt",
		expiresAt: '2027-02-20T18:00:00.000Z'
	});

	let probes = 0;

	const later = deps({
		now: () => NOW + 10_000,
		probeTls: async () => (probes++, { issuer: 'again', expiresAt: '2027-02-20T18:00:00.000Z' })
	});

	const still = await readSetupAddress('https://10.0.0.1', later);

	expect(still.tls.state).toBe('issued');
	expect(still.tls.issuer).toBe("Let's Encrypt");
	expect(probes).toBe(0);
});

test('a certificate that never appears fails after fifteen minutes', async () => {
	await setDomainAddress(DOMAIN, deps({ probeTls: async () => Promise.reject(new Error('refused')) }));

	const answer = await readSetupAddress(
		'https://10.0.0.1',
		deps({ now: () => NOW + 16 * 60_000, probeTls: async () => Promise.reject(new Error('refused')) })
	);

	expect(answer.tls.state).toBe('failed');
	expect(answer.tls.error).toContain('15 minutes');
});

test('a domain stored with TLS off reports no TLS instead of probing', async () => {
	await setDomainAddress(DOMAIN, deps());

	process.env.RECODER_TLS = 'off';

	try {
		const answer = await readSetupAddress('https://10.0.0.1', deps());

		expect(answer.tls.state).toBe('off');
	} finally {
		delete process.env.RECODER_TLS;
	}
});

test('an install with a public URL and no stored address reports it as external', async () => {
	process.env.RECODER_PUBLIC_URL = PROXY;

	try {
		const answer = await readSetupAddress('https://10.0.0.1', deps());

		expect(answer.publicUrl).toBe(PROXY);
		expect(answer.tls.state).toBe('external');
	} finally {
		delete process.env.RECODER_PUBLIC_URL;
	}
});

test('an install with nothing set reports no address', async () => {
	expect(await readSetupAddress('http://10.0.0.1', deps())).toEqual({
		reachedAt: 'http://10.0.0.1',
		publicUrl: null,
		tls: { state: 'off', domain: null }
	});

	expect(realDeps().now()).toBeGreaterThan(0);
});

test('a stored issued certificate that is close to expiry is probed again', async () => {
	const soon = new Date(NOW + 3 * 24 * 60_000).toISOString();

	const stored: StoredAddress = {
		publicUrl: `https://${DOMAIN}`,
		domain: DOMAIN,
		requestedAt: NOW,
		issued: { issuer: 'old', expiresAt: soon, seenAt: NOW - 60_000 }
	};

	await updateDeploymentState((state) => ({ ...state, address: stored }));

	let probes = 0;

	const answer = await readSetupAddress(
		'https://10.0.0.1',
		deps({ probeTls: async () => (probes++, { issuer: 'renewed', expiresAt: '2027-02-20T18:00:00.000Z' }) })
	);

	expect(probes).toBe(1);
	expect(answer.tls.issuer).toBe('renewed');
});

test('a failed re-probe does not turn an issued certificate into failed or pending', async () => {
	const stored: StoredAddress = {
		publicUrl: `https://${DOMAIN}`,
		domain: DOMAIN,
		requestedAt: NOW,
		probedAt: NOW - 60_000,
		issued: { issuer: "Let's Encrypt", expiresAt: new Date(NOW + 90 * 24 * 60_000).toISOString(), seenAt: NOW - 60_000 }
	};

	await updateDeploymentState((state) => ({ ...state, address: stored }));

	const answer = await readSetupAddress(
		'https://10.0.0.1',
		deps({ probeTls: async () => Promise.reject(new Error('reset')) })
	);

	expect(answer.tls.state).toBe('issued');
	expect(answer.tls.issuer).toBe("Let's Encrypt");
});

test('an issued certificate that has expired and no longer handshakes reports failed', async () => {
	const stored: StoredAddress = {
		publicUrl: `https://${DOMAIN}`,
		domain: DOMAIN,
		requestedAt: NOW - 200 * 24 * 60_000,
		probedAt: NOW - 60_000,
		issued: { issuer: "Let's Encrypt", expiresAt: new Date(NOW - 60_000).toISOString(), seenAt: NOW - 60_000 }
	};

	await updateDeploymentState((state) => ({ ...state, address: stored }));

	const answer = await readSetupAddress(
		'https://10.0.0.1',
		deps({ probeTls: async () => Promise.reject(new Error('reset')) })
	);

	expect(answer.tls.state).toBe('failed');
});

test('a near-expiry certificate inside the probe throttle is still reported as issued', async () => {
	const soon = new Date(NOW + 3 * 24 * 60_000).toISOString();

	const stored: StoredAddress = {
		publicUrl: `https://${DOMAIN}`,
		domain: DOMAIN,
		requestedAt: NOW - 200 * 24 * 60_000,
		probedAt: NOW,
		issued: { issuer: "Let's Encrypt", expiresAt: soon, seenAt: NOW }
	};

	await updateDeploymentState((state) => ({ ...state, address: stored }));

	const answer = await readSetupAddress('https://10.0.0.1', deps({ now: () => NOW + 10_000 }));

	expect(answer.tls.state).toBe('issued');
	expect(answer.tls.expiresAt).toBe(soon);
});
