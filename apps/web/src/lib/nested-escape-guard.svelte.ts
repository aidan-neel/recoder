/** Workaround for Sivir 0.3.2 nested floating-layer Escape dismissal. */
export function createNestedEscapeGuard(
	keys: string[],
	isActive: () => boolean
) {
	const open = $state<Record<string, boolean>>(
		Object.fromEntries(keys.map((key) => [key, false]))
	);
	let handlingNestedEscape = $state(false);
	const nestedOpen = () => Object.values(open).some(Boolean);

	$effect(() => {
		if (isActive()) return;
		for (const key of keys) open[key] = false;
		handlingNestedEscape = false;
	});

	$effect(() => {
		let release: ReturnType<typeof setTimeout> | undefined;
		const captureEscape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || !isActive()) return;
			const key = keys.find((key) => open[key]);
			if (!key) return;
			// Snapshot before document capture handlers run. A child can update its
			// binding before the parent's handler reads allowEscape in the same event.
			handlingNestedEscape = true;
			// The optimized Sivir modal/popover entries can have separate Escape
			// stacks. The modal consumes the event before the floating stack runs,
			// so close through the public binding; Sivir still owns focus/teardown.
			open[key] = false;
			event.preventDefault();
			clearTimeout(release);
			release = setTimeout(() => {
				handlingNestedEscape = false;
			}, 0);
		};
		window.addEventListener('keydown', captureEscape, true);
		return () => {
			window.removeEventListener('keydown', captureEscape, true);
			clearTimeout(release);
		};
	});

	return {
		open,
		get allowEscape() {
			return !handlingNestedEscape && !nestedOpen();
		}
	};
}
