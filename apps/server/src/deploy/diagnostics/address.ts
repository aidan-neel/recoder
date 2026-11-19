import type { SetupAddress } from '@recoder/shared';
import { publicOrigin } from '../../env';

type AddressStatus = Pick<SetupAddress, 'publicUrl' | 'tls'>;

export type AddressReader = () => AddressStatus | Promise<AddressStatus>;

export async function diagnosticAddress(readAddress?: AddressReader): Promise<AddressStatus> {
	const externalUrl = publicOrigin() ?? null;
	const configured = await readAddress?.();
	const publicUrl = configured?.publicUrl ? webOrigin(configured.publicUrl) : externalUrl;
	const domain = publicUrl ? new URL(publicUrl).hostname : null;

	if (!configured || (!configured.publicUrl && externalUrl && configured.tls.state === 'off')) {
		return { publicUrl, tls: { state: publicUrl ? 'external' : 'off', domain } };
	}

	const { state, issuer, expiresAt } = configured.tls;

	return {
		publicUrl,
		tls: {
			state,
			domain: domain ?? configured.tls.domain,
			issuer,
			expiresAt,
			...(state === 'failed' ? { error: 'The TLS certificate could not be issued.' } : {})
		}
	};
}

function webOrigin(value: string): string | null {
	const url = URL.parse(value);

	return url && (url.protocol === 'http:' || url.protocol === 'https:') ? url.origin : null;
}
