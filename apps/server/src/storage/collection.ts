export interface Collection<T extends { id: string }> {
	list(): Promise<T[]>;
	get(id: string): Promise<T | undefined>;
	set(item: T): Promise<T>;
	delete(id: string): Promise<boolean>;
	clear(): Promise<void>;
	update(id: string, mutate: (current: T | undefined) => T | undefined): Promise<T | undefined>;
}

export type Table =
	| 'repos'
	| 'reviews'
	| 'runs'
	| 'review_progress'
	| 'review_metrics'
	| 'review_checkpoints'
	| 'review_replays'
	| 'repo_chats'
	| 'images'
	| 'review_images'
	| 'accounts'
	| 'sessions'
	| 'setup'
	| 'oauth_redirects'
	| 'member_models'
	| 'update_state'
	| 'pull_states'
	| 'model_calls';
