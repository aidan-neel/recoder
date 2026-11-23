"""Preserve the allowlisted, byte-identical final freeze inside the portable package."""
import hashlib
import json
import re

from dataset_restore import safe_path


def allowed(name):
    return bool(re.fullmatch(
        r'(?:views/continuity/)?(?:manifest\.json|adjudications\.json|(?:labels|sets)/[a-z0-9-]+\.json)'
        r'|README\.md|provenance/(?:omissions\.json|audits/[a-z0-9-]+\.json)', name))


def validate_final(source, scan):
    inventory = json.loads(safe_path(source, 'SHA256SUMS.json').read_text())
    if not inventory: raise ValueError('empty final inventory')
    for name, digest in inventory.items():
        if not allowed(name): raise ValueError('unexpected final payload: '+name)
        data = safe_path(source, name).read_bytes()
        if hashlib.sha256(data).hexdigest() != digest: raise ValueError('final hash mismatch: '+name)
        scan(data.decode())
    present = {str(p.relative_to(source)) for p in source.rglob('*') if p.is_file()}
    if present != set(inventory) | {'SHA256SUMS.json'}: raise ValueError('unhashed final payload')
    manifest = json.loads((source/'manifest.json').read_text())
    if manifest['labelViews'] != dict(primary='.', continuity='views/continuity'):
        raise ValueError('unexpected final label views')
    for view in (source, source/'views/continuity'):
        if {p.stem for p in (view/'labels').glob('*.json')} != set(manifest['cases']):
            raise ValueError('incomplete final labels')


def attach_final(source, stage, package):
    inventory = json.loads((source/'SHA256SUMS.json').read_text())
    for name in [*inventory, 'SHA256SUMS.json']:
        path = stage/'frozen/final-v1'/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(safe_path(source, name).read_bytes())
    for label in (source/'views/continuity/labels').glob('*.json'):
        path = stage/'views/continuity/labels'/label.name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(label.read_bytes())
    package['labelViews'] = dict(primary='labels', continuity='views/continuity/labels')
    package['frozenFinalHash'] = hashlib.sha256((source/'SHA256SUMS.json').read_bytes()).hexdigest()
    package['viewDefects'] = {name: sum(len(json.loads(p.read_text())['defects']) for p in (stage/folder).glob('*.json'))
                             for name, folder in package['labelViews'].items()}
