/** Calls `read` now, then once a frame while `host` scrolls; the function it returns stops it. */
export function readOnScroll(host: HTMLElement, read: () => void): () => void {
	let frame = 0;

	function onScroll(): void {
		if (frame) return;

		frame = requestAnimationFrame(() => {
			frame = 0;
			read();
		});
	}

	read();
	host.addEventListener('scroll', onScroll, { passive: true });

	return () => {
		host.removeEventListener('scroll', onScroll);
		cancelAnimationFrame(frame);
	};
}
