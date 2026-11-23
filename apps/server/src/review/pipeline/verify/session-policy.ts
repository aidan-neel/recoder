/** Opaque-session budgets and claim-bound proof reuse; zero restores the legacy policy. */
export function verifierSessionFixes(): boolean {
	return process.env.RECODER_VERIFIER_SESSION_FIXES !== '0';
}
