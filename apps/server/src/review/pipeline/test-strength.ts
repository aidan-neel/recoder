/** Whether the test-strength work runs: the matrix stage, its operators, and the newer weak-test shapes. Off unless `RECODER_TEST_STRENGTH=1`. */
export function testStrengthOn(): boolean {
	return process.env.RECODER_TEST_STRENGTH === '1';
}
