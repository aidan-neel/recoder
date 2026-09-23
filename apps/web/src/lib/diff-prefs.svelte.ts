/** Diff layout and per-file "Viewed" marks. Both are conveniences, so storage failures are ignored. */
const MODE_KEY = 'recoder.diff-mode';
const VIEWED_KEY = 'recoder.viewed.';

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Preference just won't survive a refresh.
	}
}

class DiffPrefs {
	mode = $state<'unified' | 'split'>(read(MODE_KEY) === 'split' ? 'split' : 'unified');
	/** Files marked viewed in the current review. */
	viewed = $state<string[]>([]);
	#reviewId: string | null = null;

	setMode(mode: 'unified' | 'split'): void {
		this.mode = mode;
		write(MODE_KEY, mode);
	}

	/** Load the viewed marks for a review (called when a session opens). */
	useReview(reviewId: string | null): void {
		if (this.#reviewId === reviewId) return;
		this.#reviewId = reviewId;
		let stored: unknown = [];
		try {
			stored = reviewId ? JSON.parse(read(VIEWED_KEY + reviewId) ?? '[]') : [];
		} catch {
			stored = [];
		}
		this.viewed = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
	}

	isViewed(path: string): boolean {
		return this.viewed.includes(path);
	}

	setViewed(path: string, viewed: boolean): void {
		this.viewed = viewed ? [...new Set([...this.viewed, path])] : this.viewed.filter((item) => item !== path);
		if (this.#reviewId) write(VIEWED_KEY + this.#reviewId, JSON.stringify(this.viewed));
	}
}

export const diffPrefs = new DiffPrefs();
