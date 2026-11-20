import { expect, test } from 'bun:test';
import { YAML } from 'bun';
import { resolve } from 'node:path';

const chart = resolve(import.meta.dir, '..');
const fixture = resolve(import.meta.dir, 'values.yaml');

function render(...args: string[]) {
	return Bun.spawnSync(['helm', 'template', 'test', chart, '-f', fixture, ...args]);
}

function manifests(...args: string[]) {
	const result = render(...args);

	expect(result.exitCode).toBe(0);

	return result.stdout
		.toString()
		.split(/^---\s*$/m)
		.filter((part) => part.trim())
		.map((part) => YAML.parse(part));
}

function serverOf(docs: ReturnType<typeof manifests>) {
	return docs.find(
		(doc) => doc.kind === 'Deployment' && doc.metadata.labels['app.kubernetes.io/component'] === 'server'
	);
}

test('a release runs one pod that serves the app and the API, and mounts retained data apart from checkouts', () => {
	const docs = manifests();
	const deployments = docs.filter((doc) => doc.kind === 'Deployment');
	const server = serverOf(docs);
	const pvc = docs.find((doc) => doc.kind === 'PersistentVolumeClaim');
	const pod = server.spec.template.spec;
	const container = pod.containers[0];

	expect(deployments).toHaveLength(1);
	expect(server.metadata.name).toBe('test-recoder');
	expect(server.spec.replicas).toBe(1);
	expect(server.spec.strategy.type).toBe('Recreate');
	expect(container.image).toBe('ghcr.io/aidan-neel/recoder:test');
	expect(pvc.metadata.annotations['helm.sh/resource-policy']).toBe('keep');

	expect(pod.volumes).toContainEqual({ name: 'data', persistentVolumeClaim: { claimName: pvc.metadata.name } });
	expect(pod.volumes).toContainEqual({ name: 'work', emptyDir: { sizeLimit: '10Gi' } });
	expect(container.volumeMounts).toContainEqual({ name: 'data', mountPath: '/app/data' });
	expect(container.volumeMounts).toContainEqual({ name: 'work', mountPath: '/tmp/recoder-work' });
	expect(container.ports).toContainEqual({ name: 'http', containerPort: 3001 });

	expect(pod.automountServiceAccountToken).toBe(false);
	expect(pod.securityContext.runAsNonRoot).toBe(true);
	expect(container.securityContext.readOnlyRootFilesystem).toBe(true);
	expect(container.startupProbe.httpGet.port).toBe('http');

	expect(docs.find((doc) => doc.kind === 'Service').spec.ports).toContainEqual({
		name: 'http',
		port: 3001,
		targetPort: 'http'
	});
});

test("the published image is the default, and an empty tag means the chart's appVersion", () => {
	expect(
		serverOf(manifests('--set', 'server.encryptionKey.existingSecret=keys', '--set', 'server.image.tag=')).spec.template
			.spec.containers[0].image
	).toBe('ghcr.io/aidan-neel/recoder:0.2.1');

	expect(
		serverOf(
			manifests(
				'--set',
				'server.image.repository=registry.example.org/recoder',
				'--set',
				'server.encryptionKey.existingSecret=keys',
				'--set',
				'server.image.tag='
			)
		).spec.template.spec.containers[0].image
	).toBe('registry.example.org/recoder:0.2.1');
});

test('existing storage and secrets are referenced without creating replacements', () => {
	const docs = manifests(
		'--set',
		'server.persistence.existingClaim=restored-data',
		'--set',
		'server.existingSecret=credentials',
		'--set',
		'imagePullSecrets[0].name=registry'
	);

	const pod = serverOf(docs).spec.template.spec;

	expect(docs.some((doc) => ['PersistentVolumeClaim', 'Secret'].includes(doc.kind))).toBe(false);
	expect(pod.volumes).toContainEqual({ name: 'data', persistentVolumeClaim: { claimName: 'restored-data' } });
	expect(pod.containers[0].envFrom).toEqual([{ secretRef: { name: 'credentials' } }]);
	expect(pod.imagePullSecrets).toEqual([{ name: 'registry' }]);
});

test('storage class overrides distinguish the cluster default from no storage class', () => {
	const defaults = manifests().find((doc) => doc.kind === 'PersistentVolumeClaim');
	const explicit = manifests('--set', 'server.persistence.storageClass=fast').find(
		(doc) => doc.kind === 'PersistentVolumeClaim'
	);
	const noClass = manifests('--set-string', 'server.persistence.storageClass=').find(
		(doc) => doc.kind === 'PersistentVolumeClaim'
	);

	expect(defaults.spec.storageClassName).toBeUndefined();
	expect(explicit.spec.storageClassName).toBe('fast');
	expect(noClass.spec.storageClassName).toBe('');
});

test('the key that seals stored credentials comes from a Secret and never from values', () => {
	const container = serverOf(
		manifests('--set', 'server.encryptionKey.existingSecret=keys', '--set', 'server.encryptionKey.secretKey=k')
	).spec.template.spec.containers[0];

	expect(container.env).toContainEqual({
		name: 'RECODER_SECRET_KEY',
		valueFrom: { secretKeyRef: { name: 'keys', key: 'k' } }
	});
});

test('configured model endpoints and browser origins reach the API container', () => {
	const env = serverOf(
		manifests(
			'--set',
			'server.frontendUrl=https://review.example.org',
			'--set',
			'server.env.RECODER_REVIEW_BASE_URL=https://models.example.org/v1',
			'--set',
			'server.env.RECODER_REVIEW_MODEL=review-model'
		)
	).spec.template.spec.containers[0].env;

	expect(env).toContainEqual({ name: 'FRONTEND_URL', value: 'https://review.example.org' });
	expect(env).toContainEqual({ name: 'RECODER_REVIEW_BASE_URL', value: 'https://models.example.org/v1' });
	expect(env).toContainEqual({ name: 'RECODER_REVIEW_MODEL', value: 'review-model' });
});

test('a managed install is told its helm upgrade command instead of an Update button', () => {
	const without = serverOf(manifests()).spec.template.spec.containers[0].env;

	expect(without.some((entry) => entry.name === 'RECODER_MANAGED_COMMAND')).toBe(false);

	const with_ = serverOf(manifests('--set', 'server.managedCommand=helm upgrade recoder --reuse-values')).spec.template
		.spec.containers[0].env;

	expect(with_).toContainEqual({
		name: 'RECODER_MANAGED_COMMAND',
		value: 'helm upgrade recoder --reuse-values'
	});
});

test('fractional CPU resources reach the container without conversion', () => {
	const container = serverOf(manifests('--set-string', 'server.resources.requests.cpu=0.5')).spec.template.spec
		.containers[0];

	expect(container.resources.requests.cpu).toBe('0.5');
});

test('shared PostgreSQL runs multiple API replicas with rolling updates and no retained volume', () => {
	const docs = manifests(
		'--set',
		'server.replicaCount=3',
		'--set',
		'server.database.existingSecret=database',
		'--set',
		'server.database.secretKey=url'
	);

	const server = serverOf(docs);
	const container = server.spec.template.spec.containers[0];

	expect(server.spec.replicas).toBe(3);
	expect(server.spec.strategy).toEqual({ type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } });
	expect(docs.some((doc) => doc.kind === 'PersistentVolumeClaim')).toBe(false);
	expect(server.spec.template.spec.volumes).toContainEqual({ name: 'data', emptyDir: { sizeLimit: '1Gi' } });

	expect(container.env).toContainEqual({
		name: 'RECODER_DATABASE_URL',
		valueFrom: { secretKeyRef: { name: 'database', key: 'url' } }
	});

	expect(container.startupProbe.httpGet.path).toBe('/health/ready');
	expect(container.readinessProbe.httpGet.path).toBe('/health/ready');
	expect(container.livenessProbe.httpGet.path).toBe('/health');

	const budgets = docs.filter((doc) => doc.kind === 'PodDisruptionBudget');

	expect(budgets).toHaveLength(1);
	expect(budgets[0].spec.minAvailable).toBe(1);
	expect(budgets[0].metadata.labels['app.kubernetes.io/component']).toBe('server');

	const spread = server.spec.template.spec.topologySpreadConstraints;

	expect(spread[0].topologyKey).toBe('kubernetes.io/hostname');
	expect(spread[0].labelSelector.matchLabels).toEqual(server.spec.selector.matchLabels);
});

test('unsafe shared-data combinations fail before an API can scale', () => {
	for (const args of [
		['--set', 'server.replicaCount=2'],
		['--set', 'server.database.existingSecret=database', '--set', 'server.persistence.existingClaim=sqlite-data'],
		['--set', 'server.env.RECODER_DATABASE_URL=postgres://example.invalid/recoder'],
		['--set', 'app.replicaCount=2'],
		['--set', 'server.encryptionKey.existingSecret='],
		['--set', 'server.env.RECODER_SECRET_KEY=bm90LWEtcmVhbC1rZXk=']
	]) {
		const result = render(...args);

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain('schema');
	}

	expect(manifests().some((doc) => doc.kind === 'PodDisruptionBudget')).toBe(false);
});

test('API pods run between 1 and 32 reviews at once, never 0, since every pod shares the value', () => {
	const result = render('--set-string', 'server.env.RECODER_JOB_CONCURRENCY=0');

	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.toString()).toContain('schema');

	const container = serverOf(manifests('--set-string', 'server.env.RECODER_JOB_CONCURRENCY=4')).spec.template.spec
		.containers[0];

	expect(container.env).toContainEqual({ name: 'RECODER_JOB_CONCURRENCY', value: '4' });
});

test('invalid image tags, replica overrides and reserved environment overrides fail before installation', () => {
	for (const setting of [
		'server.replicas=2',
		'server.env.PORT=4000',
		'server.tmpSizeLimit=unbounded',
		'server.tmpSizeLimit=0'
	]) {
		const result = render('--set-string', setting);

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain('schema');
	}

	for (const tag of ['bad tag', 'a$tag']) {
		const result = render('--set-string', `server.image.tag=${tag}`);

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain('schema');
	}
});
