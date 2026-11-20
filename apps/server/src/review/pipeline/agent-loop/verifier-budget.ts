/** Unset, zero or invalid limits keep the existing verifier behavior. Read once per native session. */
export function verifierOpBudget(stage: string): number | null {
	const raw = process.env.RECODER_VERIFIER_OP_BUDGET;
	const value = raw && /^\d+$/.test(raw) ? Number(raw) : 0;

	return stage === 'verifier' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
