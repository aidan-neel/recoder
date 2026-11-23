import { expect, test } from 'bun:test';
import { callDiagnostics, emptyTokenUsage, type TokenCall, type VerifierSessionUsage } from '../src/index';

function call(id: string, change: Partial<TokenCall> = {}): TokenCall {
	return {
		id,
		model: 'grok-4.6',
		provider: 'openai',
		scope: 'pipeline',
		status: 'completed',
		usage: emptyTokenUsage(),
		...change
	};
}

function session(ops: number, exhausted = false): VerifierSessionUsage {
	return { id: 's1', opBudget: 40, ops, refusals: 0, prompts: 2, internalTurns: null, exhausted };
}

test('failures keep their kind, an older row’s is read from its message, and a cancellation is not one', () => {
	const { failures } = callDiagnostics([
		call('kept', { status: 'failed', error: 'LLM 500: boom', errorKind: 'timeout' }),
		call('old', { status: 'failed', error: 'LLM 429: slow down' }),
		call('stopped', { status: 'failed', error: 'Model request cancelled' }),
		call('fine')
	]);

	expect(failures?.map((failure) => [failure.id, failure.errorKind])).toEqual([
		['kept', 'timeout'],
		['old', 'rate-limit']
	]);
});

test('a verifier session reports once, with the counters of its latest call', () => {
	const { verifierSessions } = callDiagnostics([
		call('a', { verifierSession: session(3) }),
		call('b', { verifierSession: session(40, true) })
	]);

	expect(verifierSessions).toEqual([{ ...session(40, true), model: 'grok-4.6' }]);
	expect(callDiagnostics([call('c')]).verifierSessions).toBeUndefined();
});
