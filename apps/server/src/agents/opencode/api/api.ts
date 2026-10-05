import type { OpenCodeServer } from '../opencode-server';
import type { OpenCodeApi } from './types';
import { V1Api } from './v1';
import { V2Api } from './v2';

/** `1.18.34` → 1. Anything that does not parse is treated as 1, the version Recoder began with. */
function majorVersion(version: string | null): number {
	const major = Number.parseInt(version ?? '', 10);

	return Number.isFinite(major) && major > 0 ? major : 1;
}

/** The API for the OpenCode binary's major version: 2 and up speak the v2 API, anything older v1. */
export function apiFor(version: string | null, server: OpenCodeServer): OpenCodeApi {
	return majorVersion(version) >= 2 ? new V2Api(server) : new V1Api(server);
}
