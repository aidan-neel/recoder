/**
 * Finding discussion threads: model + local store.
 * Only F-01 is seeded; other findings start empty and accept messages.
 */

export interface ThreadMessage {
	id: string;
	role: 'agent' | 'user';
	author: string;
	model?: string;
	time: string;
	body: string;
}

export interface Thread {
	findingId: string;
	messages: ThreadMessage[];
}

export const PARTICIPANT_MODEL = '32b';

function now(): string {
	return new Date().toTimeString().slice(0, 8);
}

class ThreadStore {
	/** Open thread id. Null = panel closed. */
	openId = $state<string | null>(null);

	threads = $state<Record<string, Thread>>({
		'f-security-tenant': {
			findingId: 'f-security-tenant',
			messages: [
				{
					id: 'f01-m1',
					role: 'agent',
					author: 'security',
					model: PARTICIPANT_MODEL,
					time: '14:24:11',
					body: 'The port kept a module-level singleton at src/rate-limit/index.ts:7, so every tenant now shares one RateLimiter and therefore one buckets Map. Before the refactor the callers namespaced their own keys in gateway.ts. That namespacing is gone in this diff.'
				},
				{
					id: 'f01-m2',
					role: 'user',
					author: 'You',
					time: '14:25:02',
					body: 'Reachable in prod, or only in the test harness?'
				},
				{
					id: 'f01-m3',
					role: 'agent',
					author: 'security',
					model: PARTICIPANT_MODEL,
					time: '14:25:19',
					body: "Reachable. gateway.ts:88 now passes the raw IP, so two tenants behind one egress address drain each other's budget."
				}
			]
		}
	});

	get(findingId: string): Thread | undefined {
		return this.threads[findingId];
	}

	send(findingId: string, body: string, hunkRef?: string): void {
		const text = body.trim();
		if (!text) return;
		let thread = this.threads[findingId];
		if (!thread) {
			thread = { findingId, messages: [] };
			this.threads[findingId] = thread;
		}
		thread.messages.push({
			id: crypto.randomUUID(),
			role: 'user',
			author: 'You',
			time: now(),
			body: hunkRef ? `[hunk ${hunkRef}]\n${text}` : text
		});
	}

	open(findingId: string): void {
		this.openId = findingId;
	}

	close(): void {
		this.openId = null;
	}
}

export const threadsStore = new ThreadStore();
