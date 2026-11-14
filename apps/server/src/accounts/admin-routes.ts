export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Server configuration, which one person owns. Reads stay open to members so they can see which models and agents
 * a review uses; only changes are admin-only. Each group says why:
 *
 * - `/api/settings/*` writes: the review models, hosted provider keys, auto-review and local model servers
 *   (`/api/settings/vllm`). They decide what every review costs and which keys the server spends. `models/discover`
 *   is a POST because it sends the saved API key to a URL the caller picks.
 * - `/api/agent/*` writes: agent CLI provider keys and sign-ins (OpenCode providers, OAuth), which are the server's
 *   own credentials, and agent setup jobs (`install`, `sign-in`, job input and cancel), which start CLI processes
 *   on the server machine.
 * - `DELETE /api/auth/token/:provider`: the forge connection pull requests are read with.
 */
const ADMIN_WRITE_PATHS = /^\/api\/(settings|agent)(\/|$)|^\/api\/auth\/token\/[^/]+$/;

/**
 * The member list and removals: who may use the server is the admin's call, so even the list is admin-only. So is
 * the usage report, which shows what each person spent, and the update action, which swaps the server out
 * underneath everyone.
 */
const ADMIN_ONLY_PATHS = /^\/api\/(members|usage|update)(\/|$)/;

/** Whether a request changes server configuration or members, and so needs the admin. */
export function isAdminOnly(method: string, path: string): boolean {
	return ADMIN_ONLY_PATHS.test(path) || (!SAFE_METHODS.has(method) && ADMIN_WRITE_PATHS.test(path));
}
