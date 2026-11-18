/**
 * Goes to a section of the open page, as a click on a link to it does.
 * Setting the hash does nothing when the section is already the one in the
 * address, so the section is also scrolled to: a second choice of the same
 * section then goes back to it.
 */
export function openSection(id: string): void {
	window.location.hash = id;
	document.getElementById(id)?.scrollIntoView();
}
