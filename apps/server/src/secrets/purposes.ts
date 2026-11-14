import type { Provider } from '@recoder/shared';

/**
 * What each stored credential is for. The purpose is sealed with the value, so a ciphertext copied into another
 * field, provider or record does not open there.
 */
export const secretPurpose = {
	forgeToken: (provider: Provider) => `forge-token:${provider}`,
	forgeRefreshToken: (provider: Provider) => `forge-refresh-token:${provider}`,
	oauthCodeVerifier: (redirectId: string) => `oauth-code-verifier:${redirectId}`,
	reviewApiKey: 'review-api-key',
	hostedProviderKey: (providerId: string) => `hosted-provider-key:${providerId}`,
	modelKey: (entryId: string) => `model-key:${entryId}`,
	vllmKey: (serverId: string) => `vllm-key:${serverId}`
};
