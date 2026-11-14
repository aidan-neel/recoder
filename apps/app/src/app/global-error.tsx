'use client';

import { Button, StatusNotice, StatusNoticeDetails } from '@recoder/ui';
import { RotateCcw } from 'lucide-react';
import { useLayoutEffect } from 'react';

import { errorText } from '@/components/common/page-error';
import { followSystemTheme } from '@/lib/shell/theme';

import './globals.css';

interface GlobalErrorProps {
	error: unknown;
	/** Fetches and renders the app again. */
	retry: () => void;
}

/**
 * The app's frame itself broke: the same danger banner as a broken page, at
 * the top of an empty window. This replaces the whole document, so it brings
 * its own styles, and applies the saved theme before it paints: React renders
 * it on the client, where a `<script>` in its head would never run.
 */
export default function GlobalError({ error, retry }: GlobalErrorProps) {
	const details = errorText(error);

	useLayoutEffect(followSystemTheme, []);

	return (
		<html lang="en" className="dark app-skin" suppressHydrationWarning>
			<head>
				<title>Recoder</title>
			</head>
			<body>
				<main className="page">
					<div className="flex flex-col px-(--page-gutter) py-5">
						<StatusNotice
							tone="danger"
							heading="h1"
							title="Recoder hit an error."
							detail="Nothing you decided is lost."
							footer={details ? <StatusNoticeDetails code={details} /> : null}
							actions={
								<Button onClick={retry}>
									<RotateCcw aria-hidden />
									Try again
								</Button>
							}
						/>
					</div>
				</main>
			</body>
		</html>
	);
}
