/** Whether the test-strength work runs: the matrix stage, its operators, and the newer weak-test shapes. `RECODER_TEST_STRENGTH=0` turns it off, for baseline runs. */
export function testStrengthOn(): boolean {
	return process.env.RECODER_TEST_STRENGTH !== '0';
}
