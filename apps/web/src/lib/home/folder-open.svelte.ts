/** Persisted open/closed state for file-tree folders, keyed by full path. */
class FolderOpenState {
	open = $state<Record<string, boolean>>({});

	isOpen(path: string): boolean {
		return this.open[path] ?? true;
	}

	set(path: string, value: boolean): void {
		this.open[path] = value;
	}
}

export const folderOpen = new FolderOpenState();
