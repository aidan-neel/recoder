'use client';

import { Button, type ButtonVariant } from '@recoder/ui';
import { Server } from 'lucide-react';
import { useState } from 'react';

import { VllmModal } from './vllm-modal';

/** A button that opens the vLLM connect modal, for first run, where Settings' own section is not on screen. */
export function ConnectVllmButton({ variant = 'outline' }: { variant?: ButtonVariant }) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button variant={variant} onClick={() => setOpen(true)}>
				<Server aria-hidden />
				Connect vLLM server
			</Button>
			<VllmModal open={open} onOpenChange={setOpen} />
		</>
	);
}
