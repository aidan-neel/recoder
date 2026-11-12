/**
 * A px length as rem, for sizes set from JS. The kit's CSS compiles px to rem
 * (`px-to-rem.ts`) so the UI scales with the root font size on large
 * screens; inline sizes go through this to scale with it.
 */
export function rem(px: number): string {
	return `${px / 16}rem`;
}
