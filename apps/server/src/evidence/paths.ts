/** A repo-relative path with no absolute, home, empty, `.` or `..` segments; null when unsafe. */
export function sanitizeRepoPath(path: string | undefined): string | null {
	if (typeof path !== 'string' || path === '' || path.includes('\0')) return null;
	if (path.startsWith('/') || path.startsWith('~')) return null;

	const parts = path.replace(/\\/g, '/').split('/');

	if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;

	return parts.join('/');
}

/** A directory prefix, with an optional trailing slash; empty means the repo root. */
export function sanitizePrefix(prefix: string): string | null {
	if (prefix === '') return '';

	return sanitizeRepoPath(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix);
}
