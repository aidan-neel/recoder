'use client';

import { citationRef, type ChatTrailFile } from '@recoder/shared';
import { FileIcon, Pill } from '@recoder/ui';

import { fileName } from '@/lib/chat/trail';

import { useOpenFile } from './file-reference';

/** Files as small chips: the language's mark and the file's name, the whole path and its lines on hover. */
export function FileChips({ files }: { files: readonly ChatTrailFile[] }) {
	const openFile = useOpenFile();

	return (
		<ul className="trail-chips">
			{files.map((file) => {
				const chip = (
					<Pill face="code" icon={<FileIcon path={file.path} />} title={citationRef(file)}>
						{fileName(file.path)}
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
