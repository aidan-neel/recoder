/** Hunt rounds run only when `RECODER_HUNT=1`; off, the review is unchanged. */
export function huntOn(): boolean {
	return process.env.RECODER_HUNT === '1';
}

const DEFAULT_ROUNDS = 2;
const MAX_ROUNDS = 4;

/** Most hunt rounds after the first pass (`RECODER_HUNT_ROUNDS`), a whole number held between 1 and 4. */
export function huntRounds(): number {
	const value = Number(process.env.RECODER_HUNT_ROUNDS);

	if (!process.env.RECODER_HUNT_ROUNDS || !Number.isInteger(value)) return DEFAULT_ROUNDS;

	return Math.min(MAX_ROUNDS, Math.max(1, value));
}
