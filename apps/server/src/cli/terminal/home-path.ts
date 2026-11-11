import { homedir } from 'node:os';
import { sep } from 'node:path';

/** A path as a person reads it: the home directory written `~`. */
export function tildePath(path: string, home: string = homedir()): string {
	if (home === '' || home === sep) return path;

	if (path === home) return '~';

	return path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}
