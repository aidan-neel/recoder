/** Framework-aware and base-aware introduced-export checks. */
export function precisionFixes(): boolean {
	return process.env.RECODER_PRECISION_FIXES === '1';
}
