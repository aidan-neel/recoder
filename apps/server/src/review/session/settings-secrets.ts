import { isSealed, openStored, seal } from '../../secrets/seal.js';
import { secretPurpose } from '../../secrets/purposes.js';

/** The parts of the model settings that hold an API key: the custom endpoint's, each hosted provider's, each model's. */
interface SettingsWithSecrets {
	apiKey?: string;
	connections?: Record<string, { apiKey: string }>;
	models?: { id: string; apiKey?: string }[];
}

type KeyTransform = (purpose: string, key: string) => string;

/** The settings with every API key sealed, as they are saved to disk and to the shared database. */
export function sealSettingsKeys<T extends SettingsWithSecrets>(settings: T): T {
	return mapKeys(settings, seal);
}

/** The settings with every API key opened. A key saved before sealing existed is kept as it is. */
export function openSettingsKeys<T extends SettingsWithSecrets>(settings: T): T {
	return mapKeys(settings, openStored);
}

/** Whether the saved settings still hold a key that was never sealed, so they should be saved again. */
export function hasUnsealedKey(settings: SettingsWithSecrets): boolean {
	return (
		(settings.apiKey !== undefined && !isSealed(settings.apiKey)) ||
		Object.values(settings.connections ?? {}).some((connection) => !isSealed(connection.apiKey)) ||
		(settings.models ?? []).some((entry) => entry.apiKey !== undefined && !isSealed(entry.apiKey))
	);
}

function mapKeys<T extends SettingsWithSecrets>(settings: T, transform: KeyTransform): T {
	const next: T = { ...settings };

	if (settings.apiKey) next.apiKey = transform(secretPurpose.reviewApiKey, settings.apiKey);

	if (settings.connections) {
		next.connections = Object.fromEntries(
			Object.entries(settings.connections).map(([providerId, connection]) => [
				providerId,
				{ ...connection, apiKey: transform(secretPurpose.hostedProviderKey(providerId), connection.apiKey) }
			])
		);
	}

	if (settings.models) {
		next.models = settings.models.map((entry) =>
			entry.apiKey ? { ...entry, apiKey: transform(secretPurpose.modelKey(entry.id), entry.apiKey) } : entry
		);
	}

	return next;
}
