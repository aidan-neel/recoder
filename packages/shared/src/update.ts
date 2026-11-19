/**
 * "Update Recoder": the admin's in-place update of a running install. How an
 * update applies depends on how the install runs — a git checkout pulls and
 * restarts, a release binary swaps itself, and a managed deployment is told to
 * redeploy instead. `GET /api/update` serves `UpdateStatus`; the UI polls it
 * while an apply runs in the background.
 */

/**
 * How this installation runs, which decides how an update applies. `container`: the release image, with the
 * updater beside it pulling, switching and rolling back.
 */
export type UpdateMode = 'git' | 'binary' | 'container' | 'managed';

/**
 * What an update is doing, for the polling UI. `backing-up`, `health-check` and `rolling-back` are the container
 * updater's own; `rolled-back` is where a container update ends when the new version failed its health check.
 */
export type UpdateState =
	| 'idle'
	| 'checking'
	| 'pausing'
	| 'backing-up'
	| 'updating'
	| 'restarting'
	| 'health-check'
	| 'resuming'
	| 'rolling-back'
	| 'rolled-back'
	| 'failed';

/** What the updater is running: a new version, a rollback, a restore of a backup, or a move to another store. */
export type UpdateOperation = 'update' | 'rollback' | 'restore' | 'storage';

/** One step of a container update, in the order the updater runs them. */
export type UpdateStepId = 'pause' | 'backup' | 'download' | 'start' | 'health';

export interface UpdateStep {
	id: UpdateStepId;
	state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
	/** The fact the step shows (`2 running, they resume after`, `about 1.2 GB`). */
	detail?: string;
}

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
	/** Git mode, switching branches: the remote branch HEAD moves to. Unset for an update of the current branch. */
	branch?: string;
	commits: UpdateCommit[];
	changes: UpdateChanges;
	/** Container and binary mode: the release notes, as Markdown, from the release's manifest. */
	notes?: string;
	releasedAt?: string;
	/**
	 * Container mode: the release moves the data to a new data version, so rolling back from it restores the backup
	 * taken before it and loses what was written since.
	 */
	dataChange?: boolean;
}

/** `GET /api/update/branches`: the remote branches a git install can switch to, freshly fetched. */
export interface UpdateBranches {
	/** The checked-out branch; undefined on a detached HEAD. */
	current?: string;
	branches: string[];
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
	/** Container mode: what the updater is running while `state` is not idle. */
	operation?: UpdateOperation;
	/** Container mode: the update's steps, present while one is available or running. */
	steps?: UpdateStep[];
	/** Managed mode: the command that updates this install (`helm upgrade … --set server.image.tag=0.3.0`). */
	managedCommand?: string;
}

/** Container mode: when updates install on their own. */
export interface UpdatePolicy {
	channel: 'stable' | 'beta';
	/** `ask`: an admin presses Update; `auto`: the updater installs in the window. */
	install: 'ask' | 'auto';
	/** The weekly window automatic installs run in: a weekday (0 is Sunday; null every day) and an hour, 0 to 23. */
	window: { weekday: number | null; hour: number };
	/** Take a backup before every update. */
	backupFirst: boolean;
}

/** How a version in the history ended up. */
export type UpdateOutcome = 'running' | 'replaced' | 'rolled-back' | 'failed';

/**
 * One version this install ran, newest first (`GET /api/update/history`). `GET /api/update/history/:id/log`
 * answers its update's `LogPage`.
 */
export interface UpdateHistoryEntry {
	id: string;
	version: string;
	installedAt: string;
	/** Who pressed Update; null for an automatic install. */
	by: string | null;
	/** How long the update took; null when it was not an update (the first install). */
	durationMs: number | null;
	outcome: UpdateOutcome;
	/** Why it failed or was rolled back. */
	error?: string;
	/**
	 * What `POST /api/update/rollback` with this version does: `swap` starts its image on today's data,
	 * `restore` restores the backup taken before the update that replaced it (writes since are lost), `none`
	 * cannot go back to it (the running version or no backup left).
	 */
	rollback: 'swap' | 'restore' | 'none';
}
