/** An async button action that shows a pending state and ignores presses while it runs. */
export class PendingAction {
	running = $state(false);

	/** Reads the action on each run, so a reactive prop that turns null disables it. */
	constructor(private readonly action: () => (() => Promise<void>) | null) {}

	async run(): Promise<void> {
		const action = this.action();

		if (!action || this.running) return;
		this.running = true;

		try {
			await action();
		} finally {
			this.running = false;
		}
	}
}
