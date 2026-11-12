import { spyOn, type Mock } from 'bun:test';
import { toast } from '@recoder/ui';

/** The Try again button of each failure toast raised, in order. */
export const offered: (() => void)[] = [];

/** The titles of the success toasts raised, in order. */
export const confirmed: string[] = [];

/** The ids of the toasts taken away. */
export const withdrawn: (string | number | undefined)[] = [];

/** The stubbed toast calls, put back by {@link restoreToasts}. */
let spies: Mock<(...args: never[]) => unknown>[] = [];

/** Stubs the toast calls, so no toast library loads, and starts their records empty. Pass it to `beforeEach`. */
export function stubToasts(): void {
	offered.length = 0;
	confirmed.length = 0;
	withdrawn.length = 0;

	spies = [
		spyOn(toast, 'error').mockImplementation((_title, data) => {
			offered.push((data?.action as unknown as { onClick: () => void }).onClick);

			return `toast-${offered.length}`;
		}),
		spyOn(toast, 'success').mockImplementation((title) => {
			confirmed.push(String(title));

			return `toast-${confirmed.length}`;
		}),
		spyOn(toast, 'dismiss').mockImplementation((id) => void withdrawn.push(id))
	];
}

/** Puts the real toast calls back. Pass it to `afterEach`. */
export function restoreToasts(): void {
	for (const spy of spies) spy.mockRestore();
}
