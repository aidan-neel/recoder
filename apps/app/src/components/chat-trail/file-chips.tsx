'use client';

import { citationRef, type ChatTrailFile } from '@recoder/shared';
import { Pill } from '@recoder/ui';
import { FileText } from 'lucide-react';

import { fileName, lineRange } from '@/lib/chat/trail';

import { useOpenFile } from './file-reference';

/** Files as small chips: a file icon and the name, the whole path and its lines on hover. */
export function FileChips({ files }: { files: readonly ChatTrailFile[] }) {
	const openFile = useOpenFile();

	return (
		<ul className="trail-chips">
			{files.map((file) => {
				const lines = lineRange(file);

				const chip = (
					<Pill face="code" icon={<FileText />} title={citationRef(file)}>
						{fileName(file.path)}
						{lines ? `:${lines}` : ''}
					</Pill>
				);

				return (
					<li key={citationRef(file)}>
						{openFile ? (
							<button type="button" className="trail-chip-button" onClick={() => openFile(file)}>
								{chip}
							</button>
						) : (
							chip
						)}
					</li>
				);
			})}
		</ul>
	);
}
