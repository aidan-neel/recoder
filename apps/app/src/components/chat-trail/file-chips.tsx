'use client';

import { citationRef, type ChatTrailFile } from '@recoder/shared';
import { FileChip } from '@recoder/ui';

import { lineRange } from '@/lib/chat/trail';

import { useOpenFile } from './file-reference';

/** Files as small chips: the type's mark and the file's name, the whole path and its lines on hover. */
export function FileChips({ files }: { files: readonly ChatTrailFile[] }) {
	const openFile = useOpenFile();

	return (
		<ul className="trail-chips">
			{files.map((file) => (
				<li key={citationRef(file)}>
					<FileChip
						path={file.path}
						line={lineRange(file)}
						framed
						onClick={openFile ? () => openFile(file) : undefined}
					/>
				</li>
			))}
		</ul>
	);
}
