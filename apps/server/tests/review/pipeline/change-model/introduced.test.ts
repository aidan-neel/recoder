import { expect, test } from 'bun:test';
import { deadCodeResults } from '../../../../src/review/pipeline/detectors/symbols';
import { envFlag } from '../../../helpers/env-flag';
import { buildFrom } from './fixtures';

envFlag('RECODER_PRECISION_FIXES', '1');

test('replaced declarations preserve their base identity while truly new exports remain detectable', async () => {
	const { model, inventory } = await buildFrom(
		{
			'actions.py': 'class BaseAction:\n    NAME: str = "base"\nclass RetryAction:\n    NAME = "retry"\n',
			'api.ts': 'export const existing = 1;\n'
		},
		{
			'actions.py':
				'class BaseAction:\n    NAME: ClassVar[str] = "base"\nclass RetryAction:\n    NAME: ClassVar[str] = "retry"\n',
			'api.ts': 'export const existing=1;\nexport const orphan = 2;\n'
		}
	);

	for (const name of ['BaseAction.NAME', 'RetryAction.NAME', 'existing'])
		expect(model.symbols.find((symbol) => symbol.qualifiedName === name)?.change).toBe('modified');
	expect(deadCodeResults(model, inventory).map((result) => result.symbol)).toEqual(['orphan']);
});

test('an insertion-only change still reads the base and detects a genuinely new export', async () => {
	const { model, inventory } = await buildFrom(
		{ 'api.ts': 'export const existing = 1;\n' },
		{ 'api.ts': 'export const existing = 1;\nexport const orphan = 2;\n' }
	);

	expect(deadCodeResults(model, inventory).map((result) => result.symbol)).toEqual(['orphan']);
});

test('framework-discovered test entrypoints are not unused exports but ordinary source exports remain positives', async () => {
	const { model, inventory } = await buildFrom(
		{ 'README.md': 'base\n' },
		{
			'worker_test.go':
				'package worker\nimport "testing"\nfunc TestWorker(t *testing.T) {}\nfunc BenchmarkWorker(b *testing.B) {}\nfunc ExampleWorker() {}\nfunc FuzzWorker(f *testing.F) {}\nfunc TestMain(m *testing.M) {}\nfunc OrphanHelper() {}\n',
			'test_worker.py': 'def test_worker():\n    pass\nclass TestWorker:\n    def test_method(self):\n        pass\n',
			'conftest.py': 'def pytest_generate_tests(metafunc):\n    pass\n',
			'test.js': 'export function discovered() {}\n',
			'test-worker.js': 'export function discovered() {}\n',
			'worker.ts': 'export function TestOrdinary() {}\n'
		}
	);

	expect(
		deadCodeResults(model, inventory)
			.map((result) => result.symbol)
			.sort()
	).toEqual(['OrphanHelper', 'TestOrdinary']);

	expect(deadCodeResults(null, inventory)).toEqual([]);
});
