'use client';

import { usePathname } from 'next/navigation';
import { useLayoutEffect } from 'react';

import { BackToQueue, ErrorNotice } from '@/components/shell/error-notice';
import { followSystemTheme } from '@/lib/shell/theme';

import './globals.css';

interface GlobalErrorProps {
	error: unknown;
}

/**
 * The app's frame itself broke while rendering. This replaces the whole
 * document, so it brings its own styles and puts the saved theme back before
 * it paints. It renders in the browser, where a `<script>` in it would never
 * run. Rendering the frame again breaks the same way, so it offers Reload,
 * and a fresh load of the queue when another page broke it: a plain link,
 * since the router went down with the frame.
 */
export default function GlobalError({ error }: GlobalErrorProps) {
	const pathname = usePathname();

	useLayoutEffect(() => followSystemTheme(), []);

	return (
		<html lang="en" className="dark" suppressHydrationWarning>
			<head>
				<title>Recoder</title>
			</head>
			<body className="bg-canvas text-fg">
				<ErrorNotice
					error={error}
					lead="Recoder couldn’t be shown."
					rest="Your tabs and decisions are still saved in this browser."
				>
					<BackToQueue pathname={pathname} plain />
				</ErrorNotice>
			</body>
		</html>
	);
}
