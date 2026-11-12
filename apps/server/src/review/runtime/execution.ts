import { OwnershipLostError } from './ownership';
import { ReviewWorkerShutdownError } from './worker';

export function isRecoverableExit(error: unknown): boolean {
	return error instanceof OwnershipLostError || error instanceof ReviewWorkerShutdownError;
}
