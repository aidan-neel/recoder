import type { FileDiff } from '@recoder/shared';

/** Three short files; only how long each line runs matters, since no one reads it. */
const FILES: readonly (readonly [path: string, lines: readonly string[]])[] = [
	[
		'src/session/token.ts',
		[
			'export function readToken(store: TokenStore): Token | null {',
			'	const token = store.read();',
			'	if (!token || isExpired(token)) {',
			'		return null;',
			'	}',
			'	return token;',
			'}'
		]
	],
	[
		'src/session/renew.ts',
		[
			'export async function renew(store: TokenStore, client: Client): Promise<void> {',
			'	const token = readToken(store);',
			'	if (!token) return;',
			"	await withLock('session-renew', () => client.renew(token));",
			'	schedule(store, client);',
			'}'
		]
	],
	[
		'tests/session/renew.test.ts',
		[
			"test('renews a minute before the token runs out', async () => {",
			'	clock.advance(RENEW_BEFORE_MS);',
			'	expect(client.renewals).toBe(1);',
			'	clock.advance(RENEW_BEFORE_MS);',
			'	expect(client.renewals).toBe(1);',
			'});'
		]
	]
];

/**
 * Files that stand in while a pull request's diff loads. The skeleton is
 * measured from their cards, so it has a card's own header and lines of
 * code. Every line is context, so the skeleton carries no added or removed tint.
 */
export const LOADING_DIFF: readonly FileDiff[] = FILES.map(([path, lines]) => ({
	path,
	additions: 4,
	deletions: 1,
	hunks: [
		{
			header: `@@ -1,${lines.length} +1,${lines.length} @@`,
			oldStart: 1,
			oldCount: lines.length,
			newStart: 1,
			newCount: lines.length,
			lines: lines.map((text, index) => ({ type: 'context', oldNo: index + 1, newNo: index + 1, text }))
		}
	]
}));
