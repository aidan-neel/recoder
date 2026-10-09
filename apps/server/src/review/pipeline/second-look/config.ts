/** The residual pass runs only when `RECODER_RESIDUAL=1`; off, the review is unchanged. */
export function residualOn(): boolean {
	return process.env.RECODER_RESIDUAL === '1';
}

/** Contract checks run only when `RECODER_CONTRACT_CHECKS=1`; off, the review is unchanged. */
export function contractChecksOn(): boolean {
	return process.env.RECODER_CONTRACT_CHECKS === '1';
}

const DEFAULT_RESIDUAL_CAP = 6;
const DEFAULT_CONTRACT_CHECK_CAP = 4;

/** A whole number of at least 0 from `name`, else `fallback`. */
function capFrom(name: string, fallback: number): number {
	const value = Number(process.env[name]);

	return process.env[name] && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/** Residual passes one review may launch, one per unit in unit order (`RECODER_RESIDUAL_CAP`). */
export function residualCap(): number {
	return capFrom('RECODER_RESIDUAL_CAP', DEFAULT_RESIDUAL_CAP);
}

/** Contract checks one review may launch (`RECODER_CONTRACT_CHECK_CAP`). */
export function contractCheckCap(): number {
	return capFrom('RECODER_CONTRACT_CHECK_CAP', DEFAULT_CONTRACT_CHECK_CAP);
}
