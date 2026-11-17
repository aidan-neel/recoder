import { randomBytes } from 'node:crypto';
import { SECRET_KEY_BYTES } from '../../src/secrets/key-format';

/**
 * The `RECODER_SECRET_KEY` for every server a test starts on a shared database. A shared database requires one,
 * so each replica opens what another sealed, and the test preload removes the developer's own key.
 */
export const SHARED_SECRET_KEY = randomBytes(SECRET_KEY_BYTES).toString('base64');
