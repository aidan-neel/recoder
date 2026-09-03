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

class SessionState {
	sessions = $state<Session[]>([]);
	activeId = $state<string>('');
	private counter = $state(0);

	get active(): Session | undefined {
		return this.sessions.find((s) => s.id === this.activeId);
	}

	select(id: string): void {
		if (this.sessions.some((s) => s.id === id)) {
			this.activeId = id;
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
		return session;
	}

	markReady(id: string): void {
		const session = this.sessions.find((s) => s.id === id);
		if (session) session.status = 'ready';
	}

	/** Register an externally-created session (e.g. a queued backend review) without touching existing ones. */
	ensureSession(id: string, name: string, ref: string | null, status: 'reviewing' | 'ready'): void {
		if (!this.sessions.some((s) => s.id === id)) {
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
	}

	close(id: string): void {
		const index = this.sessions.findIndex((s) => s.id === id);
		if (index === -1) return;
		this.sessions = this.sessions.filter((s) => s.id !== id);
		if (this.activeId === id) {
			// Fall through to the next sibling, else the previous one.
			this.activeId = this.sessions[index]?.id ?? this.sessions[index - 1]?.id ?? '';
		}
	}
}

/** Shared session-tab state. Backed by the API in a later increment. */
export const sessionState = new SessionState();
