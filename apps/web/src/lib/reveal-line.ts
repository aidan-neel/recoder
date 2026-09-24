/**
 * Scroll a diff row into view once it renders (switching views and loading a
 * file take a few frames), then flash it so the eye lands on it.
 */
export function revealDiffLine(line: number, root: ParentNode = document, timeoutMs = 2000): void {
	const started = performance.now();
	const find = () =>
		root.querySelector<HTMLElement>(`#diff-panel [data-diff-row][data-new-no="${line}"]`) ??
		root.querySelector<HTMLElement>(`#diff-panel [data-diff-row][data-old-no="${line}"]`);
	const attempt = () => {
		const row = find();
		if (!row) {
			if (performance.now() - started < timeoutMs) requestAnimationFrame(attempt);
			return;
		}
		row.scrollIntoView({ block: 'center' });
		row.removeAttribute('data-flash');
		void row.offsetWidth;
		row.setAttribute('data-flash', '');
		setTimeout(() => row.removeAttribute('data-flash'), 1600);
	};
	requestAnimationFrame(attempt);
}
