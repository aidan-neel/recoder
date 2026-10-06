/** Obligations run only when `RECODER_OBLIGATIONS=1`; off, the review is unchanged. */
export function obligationsOn(): boolean {
	return process.env.RECODER_OBLIGATIONS === '1';
}

const DEFAULT_CAP = 6;
const DEFAULT_TIME_BOX_MS = 45_000;
const MIN_TIME_BOX_MS = 30_000;
const MAX_TIME_BOX_MS = 60_000;

/** Investigations one review may launch (`RECODER_OBLIGATION_CAP`), apart from the subagent cap. */
export function obligationCap(): number {
	const value = Number(process.env.RECODER_OBLIGATION_CAP);

	return process.env.RECODER_OBLIGATION_CAP && Number.isInteger(value) && value >= 0 ? value : DEFAULT_CAP;
}

/** Each investigation's time box (`RECODER_OBLIGATION_TIMEBOX_MS`), held between 30 and 60 seconds. */
export function obligationTimeBoxMs(): number {
	const value = Number(process.env.RECODER_OBLIGATION_TIMEBOX_MS);

	if (!process.env.RECODER_OBLIGATION_TIMEBOX_MS || !Number.isFinite(value)) return DEFAULT_TIME_BOX_MS;

	return Math.min(MAX_TIME_BOX_MS, Math.max(MIN_TIME_BOX_MS, value));
}
