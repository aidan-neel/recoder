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
