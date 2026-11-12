import { postgres, settingsOperation } from '../../storage/backend';
import { assertOwnership } from '../../review/runtime/ownership';
import {
	PostgresPublications,
	PublicationUncertainError,
	type PublicationSession
} from '../../storage/postgres-publication';
import { GhError } from '../cli';
import { keyedQueue } from '../../util/keyed-queue';
import { InlinePreparationError, PublishConflictError, rejectedPosition } from './forge';

const publications = postgres ? new PostgresPublications(postgres, assertOwnership) : undefined;

/** Without PostgreSQL this process is the only publisher, so publications of one pull request queue here instead. */
const localPublications = keyedQueue();

/**
 * Run `work` while no other publication to the same pull request (`key`)
 * runs: across processes through PostgreSQL, else within this process.
 */
export async function publicationLock<T>(key: string, work: (session?: PublicationSession) => Promise<T>): Promise<T> {
	try {
		return publications ? await publications.run(key, work) : await localPublications(key, () => work());
	} catch (error) {
		if (error instanceof PublicationUncertainError) throw new PublishConflictError(error.message);
		throw error;
	}
}

export function publicationOperation<T>(work: () => Promise<T>): Promise<T> {
	return postgres ? settingsOperation(work) : work();
}

export function missingComment(error: unknown): boolean {
	return error instanceof GhError && error.kind === 'not-found';
}

export function rejectedCreate(error: unknown): boolean {
	return (
		error instanceof InlinePreparationError ||
		(error instanceof GhError && (error.kind === 'auth' || error.kind === 'not-found' || rejectedPosition(error)))
	);
}
