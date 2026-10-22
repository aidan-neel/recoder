'use client';

import { Button } from '@recoder/ui';

import { PageNotice } from '@/components/common/page-notice';
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
		<html lang="en" className="dark" suppressHydrationWarning>
			<head>
				<title>Recoder</title>
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
			</head>
			<body className="bg-canvas text-fg">
				<PageNotice lead="Recoder hit an error." rest="Your tabs and decisions are still saved in this browser.">
					<Button variant="primary" onClick={retry}>
						Try again
					</Button>
				</PageNotice>
			</body>
		</html>
	);
}
