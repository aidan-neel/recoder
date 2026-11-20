/** Experimental opaque-session budgets and conservative claim-bound proof reuse. */
export function verifierSessionFixes(): boolean {
	return process.env.RECODER_VERIFIER_SESSION_FIXES === '1';
}
