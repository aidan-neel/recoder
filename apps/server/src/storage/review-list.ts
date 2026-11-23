import { latestReviews, reviewListItem, type Review, type ReviewListItem } from '@recoder/shared';
import { collection, postgres } from './backend';
import { sqlite } from './sqlite';
import { withFindingTiers } from './finding-tiers';
import { cacheReviewList } from './review-list-response';

/**
 * SQLite keeps the list projection apart from the full review. Triggers discard a changed review's projection,
 * including writes by another CLI or server, and the next read rebuilds only those missing inside its transaction.
 * PostgreSQL reads the shared records afresh so a replica never answers from another owner's stale snapshot.
 */
export function reviewCollection() {
	const records = collection<Review>('reviews');
	const cachedLatest = cacheReviewList<ReadonlyMap<string, ReviewListItem>>();

	async function get(id: string): Promise<Review | undefined>;
	async function get(id: string, unlessStatus: Review['status']): Promise<Review | null | undefined>;

	/** An unchanged status returns null; a missing review returns undefined. */
	async function get(id: string, unlessStatus?: Review['status']): Promise<Review | null | undefined> {
		if (!postgres && unlessStatus !== undefined) {
			const row = sqlite()
				.query<{ value: string | null }, [Review['status'], string]>(
					"SELECT CASE WHEN json_extract(value, '$.status') = ? THEN NULL ELSE value END AS value FROM reviews WHERE id = ?"
				)
				.get(unlessStatus, id);

			if (!row) return;

			return row.value === null ? null : withFindingTiers(JSON.parse(row.value) as Review);
		}

		const review = await records.get(id);

		if (unlessStatus !== undefined && review?.status === unlessStatus) return null;

		return review && withFindingTiers(review);
	}

	const reviews = {
		...records,
		get,
		list: async () => (await records.list()).map(withFindingTiers),
		set: (review: Review) => records.set(withFindingTiers(review)),
		update: (id: string, mutate: (current: Review | undefined) => Review | undefined) =>
			records.update(id, (current) => {
				const next = mutate(current && withFindingTiers(current));

				return next && withFindingTiers(next);
			}),
		startedBy: async (accountId: string): Promise<Set<string>> => {
			const rows = postgres
				? await postgres<{ id: string }[]>`
					SELECT id FROM recoder_records WHERE collection = 'reviews' AND value->>'startedBy' = ${accountId}
				`
				: sqlite()
						.query<{ id: string }, [string]>("SELECT id FROM reviews WHERE json_extract(value, '$.startedBy') = ?")
						.all(accountId);

			return new Set(rows.map(({ id }) => id));
		},
		summaries: async (): Promise<ReviewListItem[]> => {
			if (postgres) return (await records.list()).map(reviewListItem);

			const database = sqlite();

			const read = () =>
				database
					.query<{ id: string; value: string; cached: string | null }, []>(
						`SELECT r.id, coalesce(p.value, r.value) AS value, p.id AS cached
					FROM reviews r LEFT JOIN review_list_items p ON p.id = r.id ORDER BY r.rowid`
					)
					.all();

			const rows = read();

			if (rows.every((row) => row.cached !== null))
				return rows.map((row) => reviewListItem(JSON.parse(row.value) as ReviewListItem));

			return database
				.transaction(() => {
					const rows = read();

					const save = database.query('INSERT INTO review_list_items (id, value) VALUES (?, ?)');

					return rows.map((row) => {
						if (row.cached !== null) return reviewListItem(JSON.parse(row.value) as ReviewListItem);

						const item = reviewListItem(JSON.parse(row.value) as Review);

						save.run(row.id, JSON.stringify(item));

						return item;
					});
				})
				.immediate();
		}
	};

	return {
		...reviews,
		latestSummaries: () => cachedLatest(async () => latestReviews(await reviews.summaries()))
	};
}
