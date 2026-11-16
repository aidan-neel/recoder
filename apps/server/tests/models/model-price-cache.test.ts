import { afterEach, expect, spyOn, test } from 'bun:test';
import { loadPriceLookup } from '../../src/models/model-prices';
import { clearAllCaches } from '../../src/util/ttl-cache';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	clearAllCaches();
});

test('price reads share a catalog index and rebuild it when the catalog changes', async () => {
	const catalog = (price: number) =>
		Response.json({ openai: { models: { test: { cost: { input: price, output: price } } } } });

	clearAllCaches();
	spyOn(globalThis, 'fetch').mockResolvedValueOnce(catalog(1)).mockResolvedValueOnce(catalog(2));

	const [first, second] = await Promise.all([loadPriceLookup(), loadPriceLookup()]);

	expect(first).toBe(second);
	expect(first('test')?.input).toBe(1);
	clearAllCaches();
	expect((await loadPriceLookup())('test')?.input).toBe(2);
});
