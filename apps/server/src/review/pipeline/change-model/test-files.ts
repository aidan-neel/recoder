/** Folders and file names that mark a test across the supported languages. */
const TEST_PATTERNS = [
	/(^|\/)(tests?|__tests__|spec)\//,
	/\.(test|spec)\.[^./]+$/,
	/_(test|spec)\.[^./]+$/,
	/(^|\/)test_[^/]+\.py$/,
	/Tests?\.java$/
];

export function isTestPath(path: string): boolean {
	return TEST_PATTERNS.some((pattern) => pattern.test(path));
}

/** A file's base name without its extension or test markers: `gh` for `gh.ts`, `gh.test.ts`, `test_gh.py`, `GhTest.java`. */
export function testStem(path: string): string {
	return path
		.slice(path.lastIndexOf('/') + 1)
		.replace(/\.[^.]+$/, '')
		.replace(/\.(test|spec)$/, '')
		.replace(/_(test|spec)$/, '')
		.replace(/^test_/, '')
		.replace(/Tests?$/, '');
}
