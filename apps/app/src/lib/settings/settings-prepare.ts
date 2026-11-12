import { useConnections } from '../connections/connections-store';
import { useGuidelines } from '../guidelines/guidelines-store';
import { sectionFromPath, type SettingsSection } from './sections';
import { useSettings } from './settings-store';

/** The reads a section paints from, started or joined, as one wait that ends when they have all answered. */
function sectionReads(section: SettingsSection): Promise<unknown> {
	if (section === 'agent') {
		const { loadSettings, loadAgents } = useSettings.getState();

		return Promise.all([loadSettings(), loadAgents()]);
	}

	if (section === 'harness') return useSettings.getState().loadSettings();
	if (section === 'connections') return connectionReads();
	if (section === 'guidelines') return guidelineReads();

	return Promise.resolve();
}

/**
 * The forges and the repositories that are not in yet. Both loads read again
 * each time they are called, and the section reads them again as it mounts,
 * so a list already in is left for that refresh.
 */
function connectionReads(): Promise<unknown> {
	const { auth, repos, loadAuth, loadRepos } = useConnections.getState();

	return Promise.all([auth ? null : loadAuth(), repos ? null : loadRepos()]);
}

/** The overview and each tracked repository's file, unless the overview is in, which the section reads again as it mounts. */
function guidelineReads(): Promise<unknown> {
	const { overview, load } = useGuidelines.getState();

	return overview ? Promise.resolve() : load();
}

/** The wait per section still under way, which a second call joins rather than reading again. */
const preparing = new Map<SettingsSection, Promise<void>>();

/**
 * Starts or joins the reads the settings section at `path` paints from, and
 * resolves once they have all answered, loaded or failed, so the section can
 * mount whole: each section paints from its store's state as it mounts. A
 * section whose data is in resolves at once, and an address that is not a
 * section resolves at once with nothing read. It never rejects.
 */
export function prepareSection(path: string): Promise<void> {
	const section = sectionFromPath(path);

	if (!section) return Promise.resolve();

	const known = preparing.get(section);

	if (known) return known;

	const done = sectionReads(section).then(
		() => {},
		() => {}
	);

	preparing.set(section, done);
	void done.then(() => preparing.delete(section));

	return done;
}
