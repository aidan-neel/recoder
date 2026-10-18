/**
 * Runs `tick` every `ms` while the page is visible, and once each time it
 * becomes visible again, so a background tab polls nothing and catches up
 * when the person comes back. Returns the stop.
 */
export function whileVisible(ms: number, tick: () => void): () => void {
	function onVisible(): void {
		if (document.visibilityState === 'visible') tick();
	}

	const timer = setInterval(onVisible, ms);

	document.addEventListener('visibilitychange', onVisible);

	return () => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', onVisible);
	};
}
