/** Framework-aware introduced-export checks and proof-preserving publication deduplication. */
export function precisionFixes(): boolean {
	return process.env.RECODER_PRECISION_FIXES === '1';
}
