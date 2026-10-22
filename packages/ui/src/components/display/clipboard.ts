/**
 * Copies text to the clipboard. The async Clipboard API needs a secure context
 * and focus, so it falls back to a hidden textarea and `execCommand('copy')`.
 * Rejects when neither path works.
 */
export async function writeClipboard(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);

		return;
	} catch {
		copyWithTextarea(text);
	}
}

/** The legacy copy path: select the text in an off-screen textarea and ask the browser to copy it. */
function copyWithTextarea(text: string): void {
	const area = document.createElement('textarea');

	area.value = text;
	area.setAttribute('readonly', '');
	area.style.position = 'fixed';
	area.style.opacity = '0';
	area.style.pointerEvents = 'none';
	document.body.append(area);
	area.select();

	const copied = document.execCommand('copy');

	area.remove();

	if (!copied) throw new Error('The browser refused to copy.');
}
