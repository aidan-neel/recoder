import type { HomeBriefResponse, PullRequest, Repo } from '@recoder/shared';
import { serverApi } from '$lib/server-api';

/**
 * Tracked repos and their open PRs. Lives outside the Home page so the Home
 * tab can show the open-PR count and revisiting Home doesn't refetch.
 */
class OpenPrsState {
	repos = $state<Repo[]>([]);
	prsByRepo = $state<Record<string, PullRequest[]>>({});
	loadingByRepo = $state<Record<string, boolean>>({});
	errorByRepo = $state<Record<string, string | null>>({});
	/** Repos are loading for the first time. */
	loading = $state(true);
	refreshing = $state(false);
	apiDown = $state(false);
	/** Last brief shown, so Home paints it immediately on return. */
	brief = $state<HomeBriefResponse | null>(null);
	private started = false;

	/** Open PRs across every tracked repo; null until every repo has loaded. */
	get count(): number | null {
		if (this.loading || this.repos.some((repo) => this.loadingByRepo[repo.id])) return null;
		return this.repos.reduce((n, repo) => n + (this.prsByRepo[repo.id]?.length ?? 0), 0);
	}

	/** Load once per app session; later calls are no-ops. */
	async load(): Promise<void> {
		if (this.started) return;
		this.started = true;
		try {
			this.repos = await serverApi.listRepos();
			this.apiDown = false;
			this.loading = false;
			await this.loadAll();
		} catch {
			this.apiDown = true;
			this.loading = false;
		}
	}

	async loadRepo(repo: Repo, quiet = false): Promise<void> {
		if (!quiet) this.loadingByRepo[repo.id] = true;
		this.errorByRepo[repo.id] = null;
		try {
			this.prsByRepo[repo.id] = await serverApi.listPrs(repo.id);
		} catch (e) {
			if (!quiet) this.prsByRepo[repo.id] = [];
			this.errorByRepo[repo.id] = e instanceof Error ? e.message : 'Failed to list pull requests.';
		} finally {
			this.loadingByRepo[repo.id] = false;
		}
	}

	async loadAll(quiet = false): Promise<void> {
		await Promise.all(this.repos.map((repo) => this.loadRepo(repo, quiet)));
	}

	async refresh(): Promise<void> {
		if (this.refreshing) return;
		this.refreshing = true;
		try {
			if (this.apiDown) {
				this.started = false;
				await this.load();
				return;
			}
			this.repos = await serverApi.listRepos();
			await this.loadAll(true);
		} catch {
			// Keep the last list; per-repo errors render inline.
		} finally {
			this.refreshing = false;
		}
	}

	/** A repo tracked from Settings → Connections. */
	track(repo: Repo): void {
		if (this.repos.some((item) => item.id === repo.id)) return;
		this.repos = [repo, ...this.repos];
		void this.loadRepo(repo);
	}

	untrack(id: string): void {
		this.repos = this.repos.filter((repo) => repo.id !== id);
		delete this.prsByRepo[id];
	}
}

export const openPrs = new OpenPrsState();
