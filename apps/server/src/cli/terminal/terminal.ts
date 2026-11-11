import type { Audience } from '../audience.js';
import { surfaceOf, type Surface } from './surface.js';

/** Where a command's output goes and who reads it. */
export interface Terminal {
	audience: Audience;
	/** Standard output, which holds the command's result. */
	out: Surface;
	/** Standard error, which holds progress and messages. */
	err: Surface;
}

/** This process's terminal, as it is now. */
export function processTerminal(audience: Audience): Terminal {
	return {
		audience,
		out: surfaceOf(process.stdout, process.env),
		err: surfaceOf(process.stderr, process.env)
	};
}
