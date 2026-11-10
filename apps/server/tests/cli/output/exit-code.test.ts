import { expect, test } from 'bun:test';
import { EXIT } from '../../../src/cli/exit';
import { exitCodeFor } from '../../../src/cli/output/exit-code';
import type { OutputOptions } from '../../../src/cli/review/options';
import { OUTPUT, finding, report } from './fixtures';

const withWarning = report({ findings: [finding({ severity: 'warning' })] });

const withError = [finding({ severity: 'error' })];

const failOn = (value: OutputOptions['failOn']): OutputOptions => ({ ...OUTPUT, failOn: value });

test('a cancelled review exits as cancelled, whatever it found', () => {
	expect(exitCodeFor(report({ outcome: 'cancelled', findings: withError }), failOn('info'))).toBe(EXIT.cancelled);
});

test('a failed review exits as failed, whatever it found', () => {
	expect(exitCodeFor(report({ outcome: 'failed', findings: withError }), failOn('info'))).toBe(EXIT.failed);
});

test('a complete review exits ok when failOn is never', () => {
	expect(exitCodeFor(withWarning, failOn('never'))).toBe(EXIT.ok);
});

test.each([
	['info', EXIT.findings],
	['warning', EXIT.findings],
	['error', EXIT.ok]
] as const)('a warning against failOn %s exits %d', (level, code) => {
	expect(exitCodeFor(withWarning, failOn(level))).toBe(code);
});

test('an unconfirmed finding never trips failOn, even when it is written', () => {
	const unconfirmed = report({ unconfirmed: withError });

	expect(exitCodeFor(unconfirmed, { ...failOn('info'), includeUnconfirmed: true })).toBe(EXIT.ok);
});

test('a finding below minSeverity is not written, so it does not trip failOn', () => {
	expect(exitCodeFor(withWarning, { ...failOn('info'), minSeverity: 'error' })).toBe(EXIT.ok);
});
