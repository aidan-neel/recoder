import type { PendingChanges } from '@recoder/shared';
import { errorToast, undoToast } from '../shell/notify';
import { serverApi } from '../api/server-api';

/**
 * The developer's uncommitted fixes and unpushed commits for the open review.
 * Recoder never commits or pushes on its own; every step here is a click.
 */
class ChangesStore {
	reviewId = $state<string | null>(null);
	data = $state<PendingChanges | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);
	/** Files left out of the next commit (everything else is included). */
	excluded = $state<string[]>([]);
	message = $state('');
	busy = $state<null | 'commit' | 'push' | 'undo' | 'discard'>(null);
	/** The Changes sheet (one per session page, opened from either view's toolbar). */
	open = $state(false);

	show(): void {
		this.open = true;
		void this.refresh();
	}

	get count(): number {
		return (this.data?.files.length ?? 0) + (this.data?.commits.length ?? 0);
	}

	get selected(): string[] {
		return (this.data?.files ?? []).map((file) => file.path).filter((path) => !this.excluded.includes(path));
	}

	use(reviewId: string | null): void {
		if (this.reviewId === reviewId) return;
		this.reviewId = reviewId;
		this.data = null;
		this.error = null;
		this.excluded = [];
		this.message = '';
		if (reviewId) void this.refresh();
	}

	async refresh(): Promise<void> {
		const id = this.reviewId;

		if (!id) return;
		this.loading = true;

		try {
			const data = await serverApi.getChanges(id);

			if (this.reviewId !== id) return;
			this.data = data;
			this.error = null;

			const paths = new Set(data.files.map((file) => file.path));

			this.excluded = this.excluded.filter((path) => paths.has(path));
		} catch (e) {
			if (this.reviewId === id) this.error = e instanceof Error ? e.message : 'Could not load changes.';
		} finally {
			if (this.reviewId === id) this.loading = false;
		}
	}

	toggle(path: string, included: boolean): void {
		this.excluded = included ? this.excluded.filter((item) => item !== path) : [...new Set([...this.excluded, path])];
	}

	private async run(
		kind: NonNullable<ChangesStore['busy']>,
		fn: (id: string) => Promise<string | null>,
		failure: string
	): Promise<boolean> {
		const id = this.reviewId;

		if (!id || this.busy) return false;
		this.busy = kind;

		try {
			const done = await fn(id);

			if (done) undoToast(done);

			return true;
		} catch (e) {
			errorToast(failure, e instanceof Error ? e.message : undefined);

			return false;
		} finally {
			this.busy = null;
			await this.refresh();
		}
	}

	async commit(): Promise<void> {
		const paths = this.selected;
		const message = this.message.trim();

		if (!paths.length || !message) return;

		const ok = await this.run(
			'commit',
			async (id) => {
				await serverApi.commitChanges(id, paths, message);

				return `Committed ${paths.length} ${paths.length === 1 ? 'file' : 'files'}`;
			},
			'Could not commit'
		);

		if (ok) this.message = '';
	}

	push(): Promise<boolean> {
		return this.run(
			'push',
			async (id) => {
				const result = await serverApi.pushChanges(id);

				return `Pushed ${result.pushed} ${result.pushed === 1 ? 'commit' : 'commits'} to ${result.branch}`;
			},
			'Could not push'
		);
	}

	undoCommit(): Promise<boolean> {
		return this.run(
			'undo',
			async (id) => {
				await serverApi.undoCommit(id);

				return 'Commit undone; its changes are back in the working tree';
			},
			'Could not undo the commit'
		);
	}

	discard(paths: string[]): Promise<boolean> {
		return this.run(
			'discard',
			async (id) => {
				await serverApi.discardChanges(id, paths);

				return `Discarded changes to ${paths.length === 1 ? paths[0].split('/').at(-1) : `${paths.length} files`}`;
			},
			'Could not discard'
		);
	}
}

export const changesStore = new ChangesStore();
