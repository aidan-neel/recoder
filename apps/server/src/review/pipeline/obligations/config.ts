/** Obligations run only when `RECODER_OBLIGATIONS=1`; off, the review is unchanged. */
export function obligationsOn(): boolean {
	return process.env.RECODER_OBLIGATIONS === '1';
}

const DEFAULT_CAP = 8;
const DEFAULT_TURNS = 8;
const MIN_TURNS = 3;
const MAX_TURNS = 12;

/** Investigations one review may launch (`RECODER_OBLIGATION_CAP`), apart from the subagent cap. */
export function obligationCap(): number {
	const value = Number(process.env.RECODER_OBLIGATION_CAP);

	return process.env.RECODER_OBLIGATION_CAP && Number.isInteger(value) && value >= 0 ? value : DEFAULT_CAP;
}

/** Model turns each investigation gets (`RECODER_OBLIGATION_TURNS`), a whole number held between 3 and 12. */
export function obligationTurns(): number {
	const value = Number(process.env.RECODER_OBLIGATION_TURNS);

	if (!process.env.RECODER_OBLIGATION_TURNS || !Number.isInteger(value)) return DEFAULT_TURNS;

	return Math.min(MAX_TURNS, Math.max(MIN_TURNS, value));
}
