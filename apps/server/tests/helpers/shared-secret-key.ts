/**
 * The key every server a test starts against PostgreSQL shares. Shared mode refuses to start without one, and
 * `setup.ts` clears any key from the environment, so each spawned replica is handed this one.
 */
export const SHARED_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
