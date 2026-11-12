'use client';

import { Button, StatusNotice } from '@recoder/ui';

import { THEME_SCRIPT } from '@/lib/shell/theme-script';

import './globals.css';

interface GlobalErrorProps {
	error: unknown;
	/** Fetches and renders the app again. */
	retry: () => void;
}

/** The app's frame itself broke. This replaces the whole document, so it brings its own theme and styles. */
export default function GlobalError({ retry }: GlobalErrorProps) {
	return (
		<html lang="en" className="dark app-skin" suppressHydrationWarning>
			<head>
				<title>Recoder</title>
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
			</head>
			<body>
				<main className="page">
					<div className="page-notice">
						<StatusNotice
							tone="danger"
							heading="h1"
							title="Recoder hit an error."
							detail="Nothing you decided is lost."
							actions={<Button onClick={retry}>Try again</Button>}
						/>
					</div>
				</main>
			</body>
		</html>
	);
}
