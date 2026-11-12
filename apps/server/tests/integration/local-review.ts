import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { localForgeFixture } from '../helpers/local-forge';
import type { HaProcesses, Replica } from './ha-processes';

const idSchema = z.object({ id: z.string() });

export async function startLocalReview(processes: HaProcesses, replicas: Replica[]) {
	await processes.initialize();

	const replica = await processes.start('replica-a');

	replicas.push(replica);

	const fixture = await localForgeFixture();

	const directory = fileURLToPath(fixture.repo.url);

	try {
		const repo = idSchema.parse(
			await replica.json('/api/repos', {
				method: 'POST',
				body: JSON.stringify({
					name: fixture.repo.name,
					url: fixture.repo.url,
					provider: 'local',
					defaultBranch: 'main'
				})
			})
		);

		const review = idSchema.parse(
			await replica.json('/api/reviews', {
				method: 'POST',
				body: JSON.stringify({ repoId: repo.id, prNumber: 7, start: false })
			})
		);

		return { review, directory, replica };
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}
