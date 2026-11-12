import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliAgent } from './cli-process';
import type { AgentRunOptions } from './contract';
import { ProcessRun } from './process-run';

type Env = Record<string, string | undefined>;

/** What a session run needs of its adapter: the binary, the server's environment, the sets its `stop` empties, and session cleanup. */
export interface SessionHost {
	path: string;
	env: Env;
	running: Set<Bun.Subprocess>;
	scratch: Set<string>;
	/** Deletes a session the CLI saved, which holds the review's prompts; resolves once it is gone. */
	forget(session: string): Promise<void>;
}

/**
 * A run whose CLI saves one session, which each prompt after the first resumes, and whose `files` live under one
 * scratch directory. Closing the run deletes both; the adapter's `stop` deletes the directory of a run never closed.
 */
export abstract class SessionRun<Files> extends ProcessRun {
	protected session: string | undefined;
	protected prompts = 0;

	protected constructor(
		protected readonly host: SessionHost,
		options: AgentRunOptions,
		private readonly root: string,
		protected readonly files: Files
	) {
		super(options);
		host.scratch.add(root);
	}

	/** A new, empty scratch directory for one run of `cli`. */
	protected static async scratchDirectory(cli: string): Promise<string> {
		return mkdtemp(join(tmpdir(), `recoder-${cli}-run-`));
	}

	/** Returns `run` once `setUp` has written its files; if that fails, closes the run, which removes them, and rethrows. */
	protected static async ready<R extends SessionRun<unknown>>(run: R, setUp: () => Promise<void>): Promise<R> {
		try {
			await setUp();
		} catch (error) {
			await run.close();
			throw error;
		}

		return run;
	}

	/** Deletes the run's files and the session the CLI saved for it, and no other. */
	protected override async cleanUp(): Promise<void> {
		this.host.scratch.delete(this.root);
		await rm(this.root, { recursive: true, force: true });
		if (this.session) await this.host.forget(this.session);
	}
}

/** A CLI adapter whose runs each save a session, which it deletes with {@link forget}. */
export abstract class SessionCliAgent extends CliAgent {
	/** Deletes the session the CLI at `path` saved; resolves once it is gone. */
	protected abstract forget(path: string, session: string): Promise<void>;

	/** What a run of the CLI at `path` needs of this adapter. */
	protected sessionHost(path: string): SessionHost {
		return {
			path,
			env: this.env,
			running: this.running,
			scratch: this.scratch,
			forget: (session) => this.forget(path, session)
		};
	}
}
