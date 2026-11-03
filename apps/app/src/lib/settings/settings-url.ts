import { isSettingsSection, type SettingsSection } from './sections';

/** The search param that holds the open settings section: `?settings=connections`. */
const SETTINGS_PARAM = 'settings';

/** Params that belong to the settings modal and leave with it; `add=provider` asks the Agent section to open its provider dialog. */
const OWNED_PARAMS = [SETTINGS_PARAM, 'add'];

/** Where the browser is: the parts of `window.location` the settings address is built from. */
interface Place {
	pathname: string;
	search: string;
}

/** The section a page's search params open, or null while settings is closed. */
export function openSection(params: URLSearchParams): SettingsSection | null {
	const id = params.get(SETTINGS_PARAM) ?? '';

	return isSettingsSection(id) ? id : null;
}

/** The page's own params, without the ones settings owns. */
function pageParams(place: Place): URLSearchParams {
	const params = new URLSearchParams(place.search);

	for (const key of OWNED_PARAMS) params.delete(key);

	return params;
}

/** The address of the page at `place` with settings open on `section`, plus any `extra` params settings owns. */
export function settingsHref(section: SettingsSection, place: Place, extra: Record<string, string> = {}): string {
	const params = pageParams(place);

	params.set(SETTINGS_PARAM, section);

	for (const [key, value] of Object.entries(extra)) params.set(key, value);

	return `${place.pathname}?${params}`;
}

/** The address of the page at `place` with settings closed. */
function closedHref(place: Place): string {
	const query = pageParams(place).toString();

	return query ? `${place.pathname}?${query}` : place.pathname;
}

/**
 * True when this tab added the history entry that opened settings, so
 * closing steps back to the page instead of adding a second entry for it.
 * Back then closes settings, and forward opens it again.
 */
let pushed = false;

/**
 * Opens settings on `section` over the page on screen. Already open, it
 * switches section in place. Next keeps `useSearchParams` in step with the
 * history API, so nothing reloads.
 */
export function openSettings(section: SettingsSection = 'agent', extra?: Record<string, string>): void {
	const href = settingsHref(section, window.location, extra);

	if (openSection(new URLSearchParams(window.location.search))) {
		window.history.replaceState(null, '', href);

		return;
	}

	window.history.pushState(null, '', href);
	pushed = true;
}

/** Closes settings, leaving the page and its own params as they were. */
export function closeSettings(): void {
	if (pushed) {
		pushed = false;
		window.history.back();

		return;
	}

	window.history.replaceState(null, '', closedHref(window.location));
}

/** Settings closed some other way (Back, a link inside it), so there is no entry left to step back over. */
export function settingsClosed(): void {
	pushed = false;
}

/** Drops one param settings owns, keeping settings open: the provider dialog's `add` once it has closed. */
export function dropSettingsParam(key: string): void {
	const params = new URLSearchParams(window.location.search);

	params.delete(key);
	window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
}
