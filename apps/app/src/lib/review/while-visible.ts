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

/**
 * Runs `run` once after `ms`; a page hidden by then runs it when it shows
 * again, so a background tab sends no polls. Returns the cancel.
 */
export function afterVisible(ms: number, run: () => void): () => void {
	function onVisible(): void {
		if (document.visibilityState !== 'visible') return;

		document.removeEventListener('visibilitychange', onVisible);
		run();
	}

	const timer = setTimeout(() => {
		document.addEventListener('visibilitychange', onVisible);
		onVisible();
	}, ms);

	return () => {
		clearTimeout(timer);
		document.removeEventListener('visibilitychange', onVisible);
	};
}
