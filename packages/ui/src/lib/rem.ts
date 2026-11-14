/**
 * A px length as rem, for sizes set from JS. The kit's CSS compiles px to rem
 * (`px-to-rem.ts`) so the UI follows the browser's font size;
 * inline sizes go through this to follow it too.
 */
export function rem(px: number): string {
	return `${px / 16}rem`;
}
