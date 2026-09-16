export interface Session {
	id: string;
	name: string;
	/** PR number, branch, or env label shown after the name — e.g. `#4127`, `local`. */
	ref: string | null;
	/** Status dot color. */
	color: string;
	/** New sessions start reviewing; the page flips to ready when subagents settle. */
	status: 'reviewing' | 'ready';
}

const DOT_COLORS = ['#5b8cff', '#8a8f98', '#3fb96c', '#e56b6f', '#c792ea', '#e5c07b'];

const STORAGE_KEY = 'recoder.sessions.v1';

function loadStored(): { sessions: Session[]; activeId: string } {
	try {
		if (typeof localStorage === 'undefined') return { sessions: [], activeId: '' };
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { sessions: [], activeId: '' };
		const parsed = JSON.parse(raw) as { sessions?: Session[]; activeId?: string };
		const sessions = Array.isArray(parsed.sessions)
			? parsed.sessions.filter(
					(s) =>
						s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.color === 'string'
				)
			: [];
		const activeId =
			typeof parsed.activeId === 'string' && sessions.some((s) => s.id === parsed.activeId)
				? parsed.activeId
				: (sessions[0]?.id ?? '');
		return { sessions, activeId };
	} catch {
		return { sessions: [], activeId: '' };
	}
}

class SessionState {
	sessions = $state<Session[]>([]);
	activeId = $state<string>('');
	private counter = $state(0);

	constructor() {
		const stored = loadStored();
		this.sessions = stored.sessions;
		this.activeId = stored.activeId;
		// Keep untitled-N numbering collision-free across restarts.
		for (const s of stored.sessions) {
			const m = /^untitled-(\d+)$/.exec(s.name);
			if (m) this.counter = Math.max(this.counter, Number(m[1]));
		}
	}

	private persist(): void {
		try {
			if (typeof localStorage === 'undefined') return;
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: this.sessions, activeId: this.activeId }));
		} catch {
			// Storage full or unavailable — sessions just won't survive refresh.
		}
	}

	get active(): Session | undefined {
		return this.sessions.find((s) => s.id === this.activeId);
	}

	select(id: string): void {
		if (this.sessions.some((s) => s.id === id)) {
			this.activeId = id;
			this.persist();
		}
	}

	add(): Session {
		const n = ++this.counter;
		const session: Session = {
			id: crypto.randomUUID(),
			name: `untitled-${n}`,
			ref: null,
			color: DOT_COLORS[n % DOT_COLORS.length],
			status: 'reviewing'
		};
		this.sessions = [...this.sessions, session];
		this.activeId = session.id;
		this.persist();
		return session;
	}

	/** (Re)start a review for a repo: creates the session or flips it back to reviewing. */
	restartReview(id: string, name: string, ref: string | null): Session {
		let session = this.sessions.find((s) => s.id === id);
		if (!session) {
			session = {
				id,
				name,
				ref,
				color: DOT_COLORS[this.sessions.length % DOT_COLORS.length],
				status: 'reviewing'
			};
			this.sessions = [...this.sessions, session];
		} else {
			session.status = 'reviewing';
			if (ref) session.ref = ref;
		}
		this.activeId = id;
		this.persist();
		return session;
	}

	markReady(id: string): void {
		const session = this.sessions.find((s) => s.id === id);
		if (session) session.status = 'ready';
		this.persist();
	}

	duplicate(id: string): Session | undefined {
		const source = this.sessions.find((s) => s.id === id);
		if (!source) return undefined;
		const n = ++this.counter;
		const copy: Session = {
			id: crypto.randomUUID(),
			name: `${source.name} copy`,
			ref: source.ref,
			color: DOT_COLORS[n % DOT_COLORS.length],
			status: source.status
		};
		const index = this.sessions.findIndex((s) => s.id === id);
		this.sessions = [
			...this.sessions.slice(0, index + 1),
			copy,
			...this.sessions.slice(index + 1)
		];
		this.activeId = copy.id;
		this.persist();
		return copy;
	}

	/** Register an externally-created session (e.g. a queued backend review). Always reflects the latest known status. */
	ensureSession(id: string, name: string, ref: string | null, status: 'reviewing' | 'ready'): void {
		const existing = this.sessions.find((s) => s.id === id);
		if (existing) {
			existing.name = name;
			existing.ref = ref;
			existing.status = status;
		} else {
			this.sessions = [
				...this.sessions,
				{
					id,
					name,
					ref,
					color: DOT_COLORS[this.sessions.length % DOT_COLORS.length],
					status
				}
			];
		}
		this.activeId = id;
		this.persist();
	}

	closeOthers(id: string): void {
		if (!this.sessions.some((s) => s.id === id)) return;
		this.sessions = this.sessions.filter((s) => s.id === id);
		this.activeId = id;
		this.persist();
	}

	close(id: string): void {
		const index = this.sessions.findIndex((s) => s.id === id);
		if (index === -1) return;
		this.sessions = this.sessions.filter((s) => s.id !== id);
		if (this.activeId === id) {
			// Fall through to the next sibling, else the previous one.
			this.activeId = this.sessions[index]?.id ?? this.sessions[index - 1]?.id ?? '';
		}
		this.persist();
	}
}

/** Shared session-tab state. Backed by the API in a later increment. */
export const sessionState = new SessionState();
