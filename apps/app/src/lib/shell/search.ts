/** A search box's text as lowercase words. */
export function queryTerms(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}
