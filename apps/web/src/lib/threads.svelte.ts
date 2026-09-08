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
	/** True while a streamed reply is still arriving. */
	streaming?: boolean;
}

export interface Thread {
	findingId: string;
	messages: ThreadMessage[];
}

export const PARTICIPANT_MODEL = '32b';

/** Display labels for agent ids (ids stay lowercase for backend payloads). */
const AGENT_LABELS: Record<string, string> = {
	security: 'Security',
	orchestrator: 'Orchestrator',
	perf: 'Perf',
	correctness: 'Correctness',
	docs: 'Docs',
	dedup: 'Dedup',
	patterns: 'Patterns',
	testing: 'Testing',
	errors: 'Errors',
	concurrency: 'Concurrency',
	api: 'API'
};

export function formatAgentName(id?: string | null): string {
	if (!id) return '';
	return AGENT_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

function now(): string {
	return new Date().toTimeString().slice(0, 8);
}

class ThreadStore {
	/** Open thread id. Null = panel closed. */
	openId = $state<string | null>(null);
	/**
	 * Chat message queued by a finding card's "Suggest fix" (consumed by the
	 * open thread, which sends it like a typed message).
	 */
	pendingMessage = $state<{ findingId: string; text: string } | null>(null);
	/** Backend review backing the open thread (null = local-only demo threads). */
	reviewId = $state<string | null>(null);

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

	reply(findingId: string, author: string, body: string, model?: string): void {
		let thread = this.threads[findingId];
		if (!thread) {
			thread = { findingId, messages: [] };
			this.threads[findingId] = thread;
		}
		thread.messages.push({
			id: crypto.randomUUID(),
			role: 'agent',
			author,
			model,
			time: now(),
			body
		});
	}

	/** Insert an empty agent message for an in-flight stream; returns its id. */
	beginReply(findingId: string, author: string): string {
		let thread = this.threads[findingId];
		if (!thread) {
			thread = { findingId, messages: [] };
			this.threads[findingId] = thread;
		}
		const id = crypto.randomUUID();
		thread.messages.push({
			id,
			role: 'agent',
			author,
			time: now(),
			body: '',
			streaming: true
		});
		return id;
	}

	appendReply(findingId: string, id: string, text: string): void {
		const message = this.threads[findingId]?.messages.find((m) => m.id === id);
		if (message) message.body += text;
	}

	finishReply(findingId: string, id: string, author?: string, model?: string): void {
		const message = this.threads[findingId]?.messages.find((m) => m.id === id);
		if (!message) return;
		message.streaming = false;
		if (author) message.author = author;
		if (model) message.model = model;
	}

	/** Remove a streamed placeholder (e.g. the stream failed before any token). */
	dropReply(findingId: string, id: string): void {
		const thread = this.threads[findingId];
		if (!thread) return;
		thread.messages = thread.messages.filter((m) => m.id !== id);
	}

	open(findingId: string): void {
		this.openId = findingId;
	}

	/** Queue a message for the open thread to send like a typed message. */
	queueMessage(findingId: string, text: string): void {
		this.pendingMessage = { findingId, text };
	}

	close(): void {
		this.openId = null;
	}
}

export const threadsStore = new ThreadStore();
