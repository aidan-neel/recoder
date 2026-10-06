/** The running flash; a new one ends it so its timer can't cut the next flash short. */
let lastFlash: { row: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

function flash(row: HTMLElement): void {
	if (lastFlash) {
		clearTimeout(lastFlash.timer);
		lastFlash.row.removeAttribute('data-flash');
	}

	void row.offsetWidth;
	row.setAttribute('data-flash', '');
	lastFlash = { row, timer: setTimeout(() => row.removeAttribute('data-flash'), 1600) };
}

/**
 * Scroll a diff row into view once it renders (switching views and loading a
 * file take a few frames), then flash it so the eye lands on it. A new-side
 * line falls back to the old side; an old-side line (deleted code) looks there only.
 */
export function revealDiffLine(
	line: number,
	side: 'old' | 'new' = 'new',
	root: ParentNode = document,
	timeoutMs = 2000
): void {
	const started = performance.now();
	const query = (attr: string) => root.querySelector<HTMLElement>(`#diff-panel [data-diff-row][${attr}="${line}"]`);
	const find = () => (side === 'old' ? query('data-old-no') : (query('data-new-no') ?? query('data-old-no')));

	const attempt = () => {
		const row = find();

		if (!row) {
			if (performance.now() - started < timeoutMs) requestAnimationFrame(attempt);

			return;
		}

		row.scrollIntoView({ block: 'center' });
		flash(row);
	};

	requestAnimationFrame(attempt);
}
