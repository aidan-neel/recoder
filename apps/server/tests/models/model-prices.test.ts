import { expect, test } from 'bun:test';
import { priceLookupFrom } from '../../src/models/model-prices';

const catalog = {
	gateway: {
		models: {
			'claude-opus-4-5': { id: 'claude-opus-4-5', cost: { input: 99, output: 99 } },
			'qwen3-coder': { id: 'qwen3-coder', cost: { input: 0.4, output: 1.2, cache_read: 0.1 } },
			'no-price': { id: 'no-price', cost: { input: 1 } }
		}
	},
	anthropic: {
		models: {
			'claude-opus-4-5-20251101': {
				id: 'claude-opus-4-5-20251101',
				cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 }
			}
		}
	}
};

test('a model id matches without its provider path, release date or dots', () => {
	const priceOf = priceLookupFrom(catalog);
	const expected = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

	expect(priceOf('claude-opus-4-5')).toEqual(expected);
	expect(priceOf('anthropic/claude-opus-4.5')).toEqual(expected);
	expect(priceOf('openrouter/anthropic/claude-opus-4.5')).toEqual(expected);
	expect(priceOf('Claude-Opus-4-5-20251101')).toEqual(expected);
});

test('a first-party provider’s price wins over a reseller’s for the same model', () => {
	expect(priceLookupFrom(catalog)('claude-opus-4-5')?.input).toBe(5);
});

test('a model with no price, an alias or an unknown id has no price', () => {
	const priceOf = priceLookupFrom(catalog);

	expect(priceOf('no-price')).toBeNull();
	expect(priceOf('opus')).toBeNull();
	expect(priceOf('nothing-like-it')).toBeNull();
	expect(priceOf('qwen3-coder')).toEqual({ input: 0.4, output: 1.2, cacheRead: 0.1, cacheWrite: null });
});

test('a catalog that is not an object prices nothing', () => {
	expect(priceLookupFrom(null)('claude-opus-4-5')).toBeNull();
});
