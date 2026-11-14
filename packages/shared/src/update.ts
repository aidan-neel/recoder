/**
 * "Update Recoder": the admin's in-place update of a running install. How an
 * update applies depends on how the install runs — a git checkout pulls and
 * restarts, a release binary swaps itself, and a managed deployment is told to
 * redeploy instead. `GET /api/update` serves `UpdateStatus`; the UI polls it
 * while an apply runs in the background.
 */

/** How this installation runs, which decides how an update applies. */
export type UpdateMode = 'git' | 'binary' | 'managed';

/** What an update is doing, for the polling UI. */
export type UpdateState = 'idle' | 'checking' | 'pausing' | 'updating' | 'restarting' | 'resuming' | 'failed';

/** One commit a git update would bring in. */
export interface UpdateCommit {
	sha: string;
	subject: string;
}

/**
 * What the incoming changes touch, read from the workspace dependency graph:
 * `server` restarts the API (reviews pause first), `web` only needs the web
 * app seen to, and `install` owes a `bun install` (a lockfile or package.json
 * changed).
 */
export interface UpdateChanges {
	server: boolean;
	web: boolean;
	install: boolean;
}

/** What a check found waiting to apply; null when the install is current. */
export interface UpdateAvailable {
	/** Binary mode: the release it would install. Git mode leaves this unset; the commits say what is coming. */
	version?: string;
	commits: UpdateCommit[];
	changes: UpdateChanges;
}

/** How the running build identifies itself. */
export interface UpdateCurrent {
	/** Git mode: HEAD's commit. */
	commit?: string;
	/** Git mode: the checked-out branch. */
	branch?: string;
	/** The running release's version, in every mode; the app names the build by it, not by `commit`. */
	version?: string;
}

/** Whether the web app picks an update up itself or a person must redeploy it. */
export type WebRestart = 'hot-reload' | 'restart-required' | 'not-running' | 'unknown';

/** `GET /api/update`: what an update would do, and how the last one went. */
export interface UpdateStatus {
	mode: UpdateMode;
	current: UpdateCurrent;
	available: UpdateAvailable | null;
	state: UpdateState;
	/** Why `state` is 'failed'. */
	error?: string;
	/** An update exists but cannot apply (uncommitted changes, a diverged branch); says why. */
	blockedReason?: string;
	/** Reviews held for a server update, while any are. */
	pausedReviews?: number;
	/** Managed mode: how this install actually updates. */
	managedNote?: string;
	/** After a web-only update: whether the web app needs a restart. */
	webRestart?: WebRestart;
}
