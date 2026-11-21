"""Allowlisted, read-only snapshot of published local Forge PRs; no model calls."""
import argparse
import datetime
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
from urllib.parse import unquote, urlsplit

def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.PIPE)


def public_origin(value):
    url = urlsplit(value)
    if url.scheme != 'https' or url.username or url.password or url.query or url.fragment:
        raise ValueError('origin must be a credential-free public GitHub URL')
    path = url.path.removeprefix('/proxy/github.com/') if url.hostname == 'git-manager.devin.ai' else url.path.lstrip('/')
    if url.hostname not in ('github.com', 'git-manager.devin.ai') or not re.fullmatch(r'[\w.-]+/[\w.-]+', path):
        raise ValueError('unsupported upstream origin')
    return 'https://github.com/' + path


def public_text(value):
    value = re.sub(r'/home/[^\s"\x27]+', '[local-path-omitted]', value)
    if re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\b(?:ghp_|github_pat_|sk_live_)[A-Za-z0-9_]{16,}|\bAKIA[A-Z0-9]{16}\b', value):
        raise ValueError('possible credential in exportable text')
    return value


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def label_bytes(root, path, ident):
    if path.is_symlink():
        raise ValueError('symlink label')
    data = path.read_bytes()
    label = json.loads(data)
    allowed = {'id', 'codebase', 'repo', 'pull', 'headSha', 'verified', 'holdout', 'defects'}
    if set(label) - allowed or label['id'] != ident or label.get('verified') is not True:
        raise ValueError('unpublished or unexpected label schema')
    if not re.fullmatch(r'[a-z][a-z0-9-]*', ident) or not re.fullmatch(r'[a-z][a-z0-9-]*', label['codebase']):
        raise ValueError('unsafe case identifier')
    url = urlsplit(label['repo'])
    repo = Path(unquote(url.path)).resolve()
    if url.scheme != 'file' or url.netloc or not repo.is_relative_to((root/'forges').resolve()):
        raise ValueError('Forge must be inside the local forges directory')
    if type(label['pull']) is not int or label['pull'] < 1:
        raise ValueError('invalid pull number')
    public_text(data.decode())
    return data, label, repo


def snapshot(root, stage):
    source = root/'datasets/synth-rebuilt-v1'
    frozen = root/'datasets/iteration5-heldout-v1'
    manifest = json.loads((source/'manifest.json').read_text())
    held = json.loads((frozen/'manifest.json').read_text()) if frozen.exists() else {'cases': {}, 'provenance': {}}
    upstreams = {u['name']: public_origin(u['origin']) for u in json.loads((root/'upstreams.json').read_text())}
    cases = dict(manifest['cases'])
    controls = {i: c for i, c in held['cases'].items() if i.startswith('clean-')}
    if set(cases) & set(controls):
        raise ValueError('case id collision')
    cases.update(controls)
    if not cases:
        raise ValueError('no published cases')
    package = dict(format='recoder-dataset-v1', createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   cases={}, repositories={}, sets={})
    groups = {}
    for ident, case in sorted(cases.items()):
        control = ident in controls
        folder = frozen if control else source
        data, label, repo = label_bytes(root, folder/'labels'/(ident+'.json'), ident)
        for sha in (case['baseSha'], case['headSha']):
            if not re.fullmatch(r'[0-9a-f]{40}', sha): raise ValueError('invalid commit SHA')
            git(repo, 'cat-file', '-e', sha+'^{commit}')
        if case['headSha'] != label['headSha']:
            raise ValueError('publication changed during snapshot; rerun exporter')
        meta = json.loads((repo/'.git/recoder-forge.json').read_text())
        pulls = [p for p in meta['pulls'] if p['number'] == label['pull']]
        if len(pulls) != 1 or pulls[0]['baseSha'] != case['baseSha']:
            raise ValueError('published Forge metadata mismatch')
        pull = pulls[0]
        if git(repo, 'rev-parse', pull['headRef']).decode().strip() != case['headSha']:
            raise ValueError('published head differs from label')
        group = ident if control else label['codebase']
        groups.setdefault(group, dict(repo=repo, refs={}))['refs'].update({
            'base-'+case['baseSha']: case['baseSha'], 'case-'+ident: case['headSha']})
        origin = public_origin(held['provenance'][ident]['origin']) if control else upstreams[label['codebase']]
        models = case.get('generation_models')
        if not control and (not models or models.get('audit') != 'gemini-4-neon-medium'):
            raise ValueError('missing explicit generation/audit model provenance')
        audit = {}
        for defect in label['defects']:
            record = case['defects'][defect['id']]
            if record.get('accepted') is not True: raise ValueError('unaccepted label')
            verdict = record.get('audit', {})
            audit[defect['id']] = dict(accepted=True, model=record.get('independent_audit'),
                **{k: public_text(verdict[k]) for k in ('reachability', 'distinct_reason', 'expected', 'actual', 'evidence') if isinstance(verdict.get(k), str)})
        path = stage/'labels'/(ident+'.json')
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(data)
        patch = git(repo, 'diff', '--binary', '--no-ext-diff', case['baseSha'], case['headSha'])
        public_text(patch.decode('utf-8', errors='replace'))
        (stage/'patches').mkdir(exist_ok=True)
        (stage/'patches'/(ident+'.patch')).write_bytes(patch)
        package['cases'][ident] = dict(baseSha=case['baseSha'], headSha=case['headSha'], repository=group,
            labelPath='labels/'+ident+'.json', sourceLabelSha256=hashlib.sha256(data).hexdigest(),
            generation_models={k: models.get(k) for k in ('spec', 'implementation', 'injection', 'audit')} if models else None,
            kind='real-upstream-control' if control else ('generated-clean-control' if not label['defects'] else 'synthetic'),
            origin=origin, defects=audit, cleanAudit=case.get('clean_audit'),
            manualAudit=public_text(held['provenance'][ident].get('manualAudit', '')) if control else None,
            pull=dict(number=label['pull'], title=public_text(pull['title']), body=public_text(pull.get('body', '')),
                      author='benchmark-contributor', state='open', headRef='case-'+ident, baseRef='base-'+case['baseSha'], baseSha=case['baseSha']))
    for group, info in groups.items():
        bare = stage.parent/('objects-'+group)
        subprocess.run(['git', 'init', '--bare', '-q', str(bare)], check=True)
        git(bare, 'fetch', '--no-tags', str(info['repo']), *[sha+':refs/heads/'+ref for ref, sha in info['refs'].items()])
        default = next(ref for ref in info['refs'] if ref.startswith('base-'))
        git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/'+default)
        (stage/'bundles').mkdir(exist_ok=True)
        bundle = 'bundles/'+group+'.bundle'
        git(bare, 'bundle', 'create', str(stage/bundle), '--all')
        package['repositories'][group] = dict(bundle=bundle, defaultBranch=default)
    tasks = sorted(cases)
    package['sets']['all-published'] = tasks
    package['sets']['controls'] = [i for i in tasks if not json.loads((stage/'labels'/(i+'.json')).read_text())['defects']]
    for dataset in (source, frozen):
        for f in sorted((dataset/'sets').glob('*.json')):
            value = json.loads(f.read_text()); members = value['tasks']
            if set(members) <= set(tasks): package['sets'][value['name']] = members
    if frozen.exists():
        hashes = json.loads((frozen/'SHA256SUMS.json').read_text())
        for f in sorted((frozen/'labels').glob('*.json')):
            data = f.read_bytes()
            if hashlib.sha256(data).hexdigest() != hashes['labels/'+f.name]: raise ValueError('frozen labels changed')
            dest = stage/'frozen/heldout-v1/labels'/f.name
            dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(data)
        package['frozenSourceHash'] = hashlib.sha256((frozen/'SHA256SUMS.json').read_bytes()).hexdigest()
    return package


def export_dataset(root, output):
    root, output = root.resolve(), output.resolve()
    if output.exists(): raise ValueError('refusing to overwrite an existing archive')
    if not output.parent.is_dir(): raise ValueError('output parent must exist')
    with tempfile.TemporaryDirectory(prefix='dataset-package-', dir=output.parent) as temporary:
        stage = Path(temporary)/'recoder-dataset'; stage.mkdir()
        package = snapshot(root, stage)
        write_json(stage/'manifest.json', package)
        for name in ('dataset_restore.py', 'DATASET-PACKAGE.md'):
            dest = 'restore.py' if name.endswith('.py') else 'README.md'
            (stage/dest).write_bytes(Path(__file__).with_name(name).read_bytes())
        files = sorted(p for p in stage.rglob('*') if p.is_file())
        write_json(stage/'SHA256SUMS.json', {str(p.relative_to(stage)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files})
        archive = Path(temporary)/'archive.tar.gz'
        with archive.open('wb') as stream, gzip.GzipFile(filename='', mode='wb', fileobj=stream, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as tar:
                for f in sorted(p for p in stage.rglob('*') if p.is_file()):
                    info = tar.gettarinfo(str(f), arcname='recoder-dataset/'+str(f.relative_to(stage)))
                    info.uid = info.gid = info.mtime = 0; info.uname = info.gname = ''; info.mode = 0o644
                    with f.open('rb') as content: tar.addfile(info, content)
        archive.rename(output)
    result = dict(archive=str(output), bytes=output.stat().st_size, sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                  prs=len(package['cases']), defects=sum(len(c['defects']) for c in package['cases'].values()),
                  controls=len(package['sets']['controls']), modelFree=True)
    write_json(output.with_suffix(output.suffix+'.json'), result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/home/ubuntu/eval-work'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(export_dataset(args.root, args.output), indent=2))
