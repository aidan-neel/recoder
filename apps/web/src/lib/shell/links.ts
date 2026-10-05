/** The URL when a browser can open it from the app; local repos' `file://` PR links can't be. */
export function hostedUrl(url: string | null | undefined): string | null {
	return url && /^https?:\/\//.test(url) ? url : null;
}
