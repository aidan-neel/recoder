/** Read-only inspector source embedded in compiled CLI binaries, not imported as project code. */
declare module '*.inspector.js' {
	const source: string;

	export default source;
}
