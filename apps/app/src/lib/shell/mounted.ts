/**
 * True while the app has not yet taken over a full page load: the shell
 * marks `<html>` with `data-mounted` once it has (`app-shell.tsx`). Until
 * then the server's frame is on screen with its skeleton still unseen.
 */
export function beforeMount(): boolean {
	return !document.documentElement.hasAttribute('data-mounted');
}
