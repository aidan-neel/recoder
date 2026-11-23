"""Verify the extracted allowlisted archive and materialize local Forge repositories."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


def safe_path(root, name):
    path = root/name
    if Path(name).is_absolute() or '..' in Path(name).parts or any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError('unsafe archive path')
    if not path.resolve().is_relative_to(root.resolve()): raise ValueError('archive path escape')
    return path


def restore(source, output):
    source, output = source.resolve(), output.resolve()
    hashes = json.loads((source/'SHA256SUMS.json').read_text())
    for name, digest in hashes.items():
        if hashlib.sha256(safe_path(source, name).read_bytes()).hexdigest() != digest:
            raise ValueError('archive hash mismatch: '+name)
    manifest = json.loads(safe_path(source, 'manifest.json').read_text())
    if manifest['format'] != 'recoder-dataset-v1': raise ValueError('unsupported format')
    if output.exists(): raise ValueError('output must not exist')
    for group, repo in manifest['repositories'].items():
        if not re.fullmatch(r'[a-z][a-z0-9-]*', group): raise ValueError('invalid repository id')
        if repo['bundle'] not in hashes: raise ValueError('unhashed bundle')
        safe_path(source, repo['bundle'])
    for ident, case in manifest['cases'].items():
        if not re.fullmatch(r'[a-z][a-z0-9-]*', ident): raise ValueError('invalid case id')
        if case['labelPath'] not in hashes: raise ValueError('unhashed label')
        for sha in (case['baseSha'], case['headSha']):
            if not re.fullmatch(r'[0-9a-f]{40}', sha): raise ValueError('invalid commit id')
        for key in ('headRef', 'baseRef'):
            if not re.fullmatch(r'(case|base)-[a-z0-9-]+', case['pull'][key]): raise ValueError('unsafe ref')
    output.mkdir(parents=True)
    for group, repo in manifest['repositories'].items():
        target = output/'repos'/group; target.parent.mkdir(exist_ok=True)
        subprocess.run(['git', 'clone', '--quiet', str(safe_path(source, repo['bundle'])), str(target)], check=True)
        pulls = []
        for ident, case in manifest['cases'].items():
            if case['repository'] != group: continue
            for key, sha in (('headRef', case['headSha']), ('baseRef', case['baseSha'])):
                subprocess.run(['git', '-C', str(target), 'update-ref', 'refs/heads/'+case['pull'][key], sha], check=True)
            subprocess.run(['git', '-C', str(target), 'update-ref', 'refs/pull/'+str(case['pull']['number'])+'/head', case['headSha']], check=True)
            pulls.append(case['pull'])
            label = json.loads(safe_path(source, case['labelPath']).read_text())
            if label['id'] != ident or label['headSha'] != case['headSha']: raise ValueError('label/manifest mismatch')
            label['repo'] = target.as_uri()
            (output/'labels').mkdir(exist_ok=True)
            (output/'labels'/(ident+'.json')).write_text(json.dumps(label, indent=2)+'\n')
        (target/'.git/recoder-forge.json').write_text(json.dumps(dict(defaultBranch=repo['defaultBranch'], pulls=pulls, issues=[]), indent=2)+'\n')
    (output/'sets').mkdir()
    for name, tasks in manifest['sets'].items():
        if not re.fullmatch(r'[a-z][a-z0-9-]*', name) or not set(tasks) <= manifest['cases'].keys(): raise ValueError('invalid set')
        (output/'sets'/(name+'.json')).write_text(json.dumps(dict(name=name, tasks=tasks, sources=['portable archive']), indent=2)+'\n')
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    (output/'adjudications.json').write_text('{}\n')
    views = manifest.get('labelViews', {})
    if views:
        if views != dict(primary='labels', continuity='views/continuity/labels'):
            raise ValueError('unsupported label views')
        view = output/'views/continuity'
        (view/'labels').mkdir(parents=True)
        (view/'sets').mkdir()
        for ident, case in manifest['cases'].items():
            name = views['continuity']+'/'+ident+'.json'
            if name not in hashes: raise ValueError('unhashed continuity label')
            label = json.loads(safe_path(source, name).read_text())
            if label['id'] != ident or label['headSha'] != case['headSha']: raise ValueError('continuity label mismatch')
            label['repo'] = (output/'repos'/case['repository']).as_uri()
            (view/'labels'/(ident+'.json')).write_text(json.dumps(label, indent=2)+'\n')
        for path in (output/'sets').glob('*.json'): (view/'sets'/path.name).write_bytes(path.read_bytes())
        (view/'manifest.json').write_text(json.dumps(dict(manifest, view='continuity'), indent=2)+'\n')
        (view/'adjudications.json').write_text('{}\n')
    return dict(dataset=str(output), prs=len(manifest['cases']), verifiedFiles=len(hashes))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(restore(Path(__file__).resolve().parent, args.output), indent=2))
