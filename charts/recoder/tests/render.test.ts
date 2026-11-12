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

test('a release keeps one API writer and mounts retained data separately from disposable checkouts', () => {
	const docs = manifests();
	const deployments = docs.filter((doc) => doc.kind === 'Deployment');
	const server = deployments.find((doc) => doc.metadata.labels['app.kubernetes.io/component'] === 'server');
	const pvc = docs.find((doc) => doc.kind === 'PersistentVolumeClaim');

	expect(deployments).toHaveLength(2);
	expect(server.spec.replicas).toBe(1);
	expect(server.spec.strategy.type).toBe('Recreate');
	expect(pvc.metadata.annotations['helm.sh/resource-policy']).toBe('keep');

	expect(server.spec.template.spec.volumes).toContainEqual({
		name: 'data',
		persistentVolumeClaim: { claimName: pvc.metadata.name }
	});

	expect(server.spec.template.spec.volumes).toContainEqual({ name: 'work', emptyDir: { sizeLimit: '10Gi' } });
	expect(server.spec.template.spec.containers[0].volumeMounts).toContainEqual({ name: 'data', mountPath: '/app/data' });

	for (const deployment of deployments) {
		const pod = deployment.spec.template.spec;

		expect(pod.automountServiceAccountToken).toBe(false);
		expect(pod.securityContext.runAsNonRoot).toBe(true);
		expect(pod.containers[0].securityContext.readOnlyRootFilesystem).toBe(true);
		expect(pod.containers[0].startupProbe.httpGet.port).toBe('http');
	}

	expect(docs.filter((doc) => doc.kind === 'Service').every((doc) => doc.spec.type === 'ClusterIP')).toBe(true);
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

	const server = docs.find(
		(doc) => doc.kind === 'Deployment' && doc.metadata.labels['app.kubernetes.io/component'] === 'server'
	);

	const pod = server.spec.template.spec;

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

test('configured model endpoints and browser origins reach the API container', () => {
	const docs = manifests(
		'--set',
		'server.frontendUrl=https://review.example.org',
		'--set',
		'server.env.RECODER_REVIEW_BASE_URL=https://models.example.org/v1',
		'--set',
		'server.env.RECODER_REVIEW_MODEL=review-model'
	);

	const server = docs.find(
		(doc) => doc.kind === 'Deployment' && doc.metadata.labels['app.kubernetes.io/component'] === 'server'
	);

	const env = server.spec.template.spec.containers[0].env;

	expect(env).toContainEqual({ name: 'FRONTEND_URL', value: 'https://review.example.org' });
	expect(env).toContainEqual({ name: 'RECODER_REVIEW_BASE_URL', value: 'https://models.example.org/v1' });
	expect(env).toContainEqual({ name: 'RECODER_REVIEW_MODEL', value: 'review-model' });
});

test('fractional CPU resources reach the container without conversion', () => {
	const docs = manifests('--set-string', 'server.resources.requests.cpu=0.5');

	const server = docs.find(
		(doc) => doc.kind === 'Deployment' && doc.metadata.labels['app.kubernetes.io/component'] === 'server'
	);

	expect(server.spec.template.spec.containers[0].resources.requests.cpu).toBe('0.5');
});

test('shared PostgreSQL runs multiple API replicas with rolling updates and no retained volume', () => {
	const docs = manifests(
		'--set',
		'server.replicaCount=3',
		'--set',
		'app.replicaCount=2',
		'--set',
		'server.database.existingSecret=database',
		'--set',
		'server.database.secretKey=url'
	);

	const deployments = docs.filter((doc) => doc.kind === 'Deployment');
	const server = deployments.find((doc) => doc.metadata.labels['app.kubernetes.io/component'] === 'server');
	const app = deployments.find((doc) => doc.metadata.labels['app.kubernetes.io/component'] === 'app');
	const pod = server.spec.template.spec;
	const container = pod.containers[0];

	expect(server.spec.replicas).toBe(3);
	expect(app.spec.replicas).toBe(2);
	expect(server.spec.strategy).toEqual({ type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } });
	expect(app.spec.strategy.type).toBe('RollingUpdate');
	expect(docs.some((doc) => doc.kind === 'PersistentVolumeClaim')).toBe(false);
	expect(pod.volumes).toContainEqual({ name: 'data', emptyDir: { sizeLimit: '1Gi' } });

	expect(container.env).toContainEqual({
		name: 'RECODER_DATABASE_URL',
		valueFrom: { secretKeyRef: { name: 'database', key: 'url' } }
	});

	expect(container.startupProbe.httpGet.path).toBe('/health/ready');
	expect(container.readinessProbe.httpGet.path).toBe('/health/ready');
	expect(container.livenessProbe.httpGet.path).toBe('/health');

	const budgets = docs.filter((doc) => doc.kind === 'PodDisruptionBudget');

	expect(budgets).toHaveLength(2);
	expect(budgets.every((doc) => doc.spec.minAvailable === 1)).toBe(true);

	for (const deployment of deployments) {
		const spread = deployment.spec.template.spec.topologySpreadConstraints;

		expect(spread[0].topologyKey).toBe('kubernetes.io/hostname');
		expect(spread[0].labelSelector.matchLabels).toEqual(deployment.spec.selector.matchLabels);
	}
});

test('unsafe shared-data combinations fail before an API can scale', () => {
	for (const args of [
		['--set', 'server.replicaCount=2'],
		['--set', 'server.database.existingSecret=database', '--set', 'server.persistence.existingClaim=sqlite-data'],
		['--set', 'server.env.RECODER_DATABASE_URL=postgres://example.invalid/recoder'],
		['--set', 'app.replicaCount=0']
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

	const server = manifests('--set-string', 'server.env.RECODER_JOB_CONCURRENCY=4').find(
		(doc) => doc.kind === 'Deployment' && doc.metadata.labels['app.kubernetes.io/component'] === 'server'
	);

	expect(server.spec.template.spec.containers[0].env).toContainEqual({ name: 'RECODER_JOB_CONCURRENCY', value: '4' });
});

test('frontend replicas can scale while SQLite keeps one API writer', () => {
	const docs = manifests('--set', 'app.replicaCount=2');

	const server = docs.find(
		(doc) => doc.kind === 'Deployment' && doc.metadata.labels['app.kubernetes.io/component'] === 'server'
	);

	const budgets = docs.filter((doc) => doc.kind === 'PodDisruptionBudget');

	expect(server.spec.replicas).toBe(1);
	expect(server.spec.strategy.type).toBe('Recreate');
	expect(docs.filter((doc) => doc.kind === 'PersistentVolumeClaim')).toHaveLength(1);
	expect(budgets.map((doc) => doc.metadata.labels['app.kubernetes.io/component'])).toEqual(['app']);
});

test('invalid image tags, replica overrides and reserved environment overrides fail before installation', () => {
	for (const setting of [
		'server.image.tag=',
		'server.replicas=2',
		'server.env.PORT=4000',
		'server.tmpSizeLimit=unbounded',
		'server.tmpSizeLimit=0',
		'server.resources.requests.cpu=lots'
	]) {
		const result = render('--set-string', setting);

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain('schema');
	}

	const missingImages = Bun.spawnSync(['helm', 'template', 'test', chart]);

	expect(missingImages.exitCode).not.toBe(0);
});
