import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { secretKey } from './secret-key';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A sealed value that could not be opened: changed, cut short, sealed for another purpose or with another key. */
export class SealedValueError extends Error {
	constructor(
		readonly purpose: string,
		options?: ErrorOptions
	) {
		super(
			`The stored value for "${purpose}" could not be decrypted. It was changed, or it was sealed with a different ` +
				'RECODER_SECRET_KEY.',
			options
		);

		this.name = 'SealedValueError';
	}
}

/** Whether a stored value is sealed. Anything else is a credential saved before sealing existed. */
export function isSealed(stored: string): boolean {
	return stored.startsWith(PREFIX);
}

/**
 * Seals `plaintext` as `enc:v1:<base64 of iv, tag and ciphertext>`. The purpose (`forge-token:github`) is
 * authenticated with it, so the result opens only for that purpose and a copy moved to another field is refused.
 */
export function seal(purpose: string, plaintext: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, secretKey().key, iv);

	cipher.setAAD(Buffer.from(purpose));

	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

	return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/** Opens a value `seal` made for the same purpose. Throws {@link SealedValueError} when it cannot, naming the purpose. */
export function open(purpose: string, sealed: string): string {
	if (!isSealed(sealed)) throw new SealedValueError(purpose);

	const bytes = Buffer.from(sealed.slice(PREFIX.length), 'base64');

	if (bytes.length < IV_BYTES + TAG_BYTES) throw new SealedValueError(purpose);

	try {
		const decipher = createDecipheriv(ALGORITHM, secretKey().key, bytes.subarray(0, IV_BYTES));

		decipher.setAAD(Buffer.from(purpose));
		decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

		return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
	} catch (error) {
		throw new SealedValueError(purpose, { cause: error });
	}
}

/** The plaintext of a stored value: opened when sealed, as it is when it predates sealing. */
export function openStored(purpose: string, stored: string): string {
	return isSealed(stored) ? open(purpose, stored) : stored;
}
