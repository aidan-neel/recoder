import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setupLogUrl } from '../../src/accounts/setup-code';

/** The variables `setupLogUrl` reads, saved before each test and restored after, so none leaks into another. */
const KEYS = ['FRONTEND_URL', 'RECODER_PUBLIC_URL', 'KUBERNETES_SERVICE_HOST', 'NODE_ENV'] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
	for (const key of KEYS) saved.set(key, process.env[key]);

	delete process.env.FRONTEND_URL;
	delete process.env.RECODER_PUBLIC_URL;
	delete process.env.KUBERNETES_SERVICE_HOST;
	delete process.env.NODE_ENV;
});

afterEach(() => {
	for (const [key, value] of saved) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test('a deployment that sets FRONTEND_URL gets it printed', () => {
	process.env.FRONTEND_URL = 'https://recoder.example.org';

	expect(setupLogUrl()).toBe('https://recoder.example.org');
});

test('FRONTEND_URL wins over RECODER_PUBLIC_URL while the app is a separate origin', () => {
	process.env.FRONTEND_URL = 'https://recoder.example.org';
	process.env.RECODER_PUBLIC_URL = 'https://api.recoder.example.org';

	expect(setupLogUrl()).toBe('https://recoder.example.org');
});

test('a public URL is printed when FRONTEND_URL is unset', () => {
	process.env.RECODER_PUBLIC_URL = 'https://recoder.example.org';

	expect(setupLogUrl()).toBe('https://recoder.example.org');
});

test('a container with neither set gets the server its own port', () => {
	process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';

	expect(setupLogUrl()).toBe('http://localhost:3001');
});

test('a checkout with neither set gets the port bun run dev serves the app on', () => {
	expect(setupLogUrl()).toBe('http://localhost:5180');
});
