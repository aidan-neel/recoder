import { postgres, settingsOperation } from '../../storage/backend';
import { assertOwnership } from '../../review/runtime/ownership';
import {
	PostgresPublications,
	PublicationUncertainError,
	type PublicationSession
} from '../../storage/postgres-publication';
import { GhError } from '../cli';
import { InlinePreparationError, PublishConflictError } from './forge';

const publications = postgres ? new PostgresPublications(postgres, assertOwnership) : undefined;

export async function publicationLock<T>(key: string, work: (session?: PublicationSession) => Promise<T>): Promise<T> {
	try {
		return publications ? await publications.run(key, work) : await work();
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

export function rejectedPosition(error: unknown): boolean {
	return (
		error instanceof GhError &&
		error.kind === 'unknown' &&
		(/^GitHub API (400|422):/.test(error.message) ||
			/^[^\n]+ returned (400|422):/.test(error.message) ||
			/^GitLab has not computed this merge request/.test(error.message))
	);
}

export function rejectedCreate(error: unknown): boolean {
	return (
		error instanceof InlinePreparationError ||
		(error instanceof GhError && (error.kind === 'auth' || error.kind === 'not-found' || rejectedPosition(error)))
	);
}
