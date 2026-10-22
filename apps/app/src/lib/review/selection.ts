/** What the reading pane shows. */
export type Selection =
	| { kind: 'overview' }
	| { kind: 'decision'; id: string }
	| { kind: 'receipt'; id: string }
	| { kind: 'file'; path: string };

/** A string that names a selection, for keys and comparisons. */
export function selectionKey(selection: Selection): string {
	if (selection.kind === 'overview') return 'overview';
	if (selection.kind === 'file') return `file:${selection.path}`;

	return `${selection.kind}:${selection.id}`;
}

/** True when two selections point at the same thing. */
export function sameSelection(a: Selection, b: Selection): boolean {
	return selectionKey(a) === selectionKey(b);
}

/** The value a link carries for a selection (`?item=`): the decision or receipt id, or the file path; null for the overview. */
export function itemOf(selection: Selection): string | null {
	if (selection.kind === 'overview') return null;

	return selection.kind === 'file' ? selection.path : selection.id;
}

/** The selection a link's item names among the review's items, decisions first; null when the review has no such item. */
export function selectionForItem(item: string, order: readonly Selection[]): Selection | null {
	return order.find((selection) => itemOf(selection) === item) ?? null;
}
