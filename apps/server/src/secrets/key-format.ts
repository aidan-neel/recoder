/** An AES-256 key is 32 bytes. */
export const SECRET_KEY_BYTES = 32;

/**
 * The key a text holds: exactly 32 bytes in canonical base64 (`openssl rand -base64 32`), surrounding whitespace
 * ignored. Undefined for anything else, so a typo or a truncated paste is refused instead of read as a weaker key.
 */
export function decodeSecretKey(text: string): Buffer | undefined {
	const trimmed = text.trim();
	const key = Buffer.from(trimmed, 'base64');

	return key.length === SECRET_KEY_BYTES && key.toString('base64') === trimmed ? key : undefined;
}
