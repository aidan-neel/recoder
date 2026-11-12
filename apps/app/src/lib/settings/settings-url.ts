/** Drops one param the settings page owns, keeping the rest of the address: the provider dialog's `add` once it has closed. */
export function dropPageParam(key: string): void {
	const params = new URLSearchParams(window.location.search);

	params.delete(key);

	const query = params.toString();

	window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
}
