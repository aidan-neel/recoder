import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

from dataset_package import export_dataset, public_origin, public_text
from dataset_restore import restore, safe_path
from final_package import validate_final


class DatasetPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory()
        cls.root = Path(cls.fixture.name)
        repo = cls.root/'forges/example'; repo.mkdir(parents=True)
        def git(*args):
            env = dict(os.environ, GIT_AUTHOR_NAME='Fixture', GIT_AUTHOR_EMAIL='fixture@example.org',
                       GIT_COMMITTER_NAME='Fixture', GIT_COMMITTER_EMAIL='fixture@example.org')
            return subprocess.check_output(['git', '-C', str(repo), '-c', 'core.hooksPath=/dev/null', *args], env=env, stderr=subprocess.PIPE).decode().strip()
        git('init', '-q')
        (repo/'source.py').write_text('value = 1\n'); git('add', 'source.py'); git('commit', '-qm', 'base')
        cls.base = git('rev-parse', 'HEAD')
        (repo/'source.py').write_text('value = 2\n'); git('add', 'source.py'); git('commit', '-qm', 'feature')
        cls.head = git('rev-parse', 'HEAD'); git('update-ref', 'refs/heads/published', cls.head)
        (repo/'private.txt').write_text('PRIVATE_UNPUBLISHED_SENTINEL'); git('add', 'private.txt'); git('commit', '-qm', 'private')
        cls.private = git('rev-parse', 'HEAD')
        pull = dict(number=1, title='Public feature', body='Intent only', baseSha=cls.base, headRef='published')
        (repo/'.git/recoder-forge.json').write_text(json.dumps(dict(pulls=[pull])))
        (repo/'.git/auth.txt').write_text('PRIVATE_AUTH_SENTINEL')
        (cls.root/'raw-exports').mkdir(); (cls.root/'raw-exports/secret.json').write_text('PRIVATE_RAW_SENTINEL')
        dataset = cls.root/'datasets/synth-rebuilt-v1'; (dataset/'labels').mkdir(parents=True); (dataset/'sets').mkdir()
        cls.label = dict(id='example-1', codebase='example', repo=repo.as_uri(), pull=1, headSha=cls.head, verified=True, holdout=False, defects=[])
        (dataset/'labels/example-1.json').write_text(json.dumps(cls.label))
        case = dict(baseSha=cls.base, headSha=cls.head, clean_audit=True, defects={}, generation_models=dict(spec='gemini-4-neon-medium', implementation='swe-2-high', injection='swe-2-flash-high', audit='gemini-4-neon-medium'))
        (dataset/'manifest.json').write_text(json.dumps(dict(cases={'example-1': case})))
        (cls.root/'upstreams.json').write_text(json.dumps([dict(name='example', origin='https://github.com/example/project.git')]))

    @classmethod
    def tearDownClass(cls): cls.fixture.cleanup()

    def test_archive_restores_original_commits_and_excludes_unpublished_objects_and_auth(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); archive = root/'dataset.tar.gz'
            result = export_dataset(self.root, archive)
            self.assertEqual(result['prs'], 1)
            with tarfile.open(archive) as tar:
                self.assertTrue(all(m.isfile() and not m.name.startswith('/') and '..' not in Path(m.name).parts for m in tar))
                tar.extractall(root, filter='data')
            package = root/'recoder-dataset'
            manifest = json.loads((package/'manifest.json').read_text())
            self.assertEqual(manifest['cases']['example-1']['generation_models']['injection'], 'swe-2-flash-high')
            self.assertEqual((package/'labels/example-1.json').read_bytes(), (self.root/'datasets/synth-rebuilt-v1/labels/example-1.json').read_bytes())
            restore(package, root/'restored')
            repo = root/'restored/repos/example'
            self.assertEqual(subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'case-example-1']).decode().strip(), self.head)
            self.assertNotEqual(subprocess.run(['git', '-C', str(repo), 'cat-file', '-e', self.private], capture_output=True).returncode, 0)
            self.assertFalse((repo/'.git/auth.txt').exists())
            self.assertFalse(any('raw-exports' in str(p) for p in package.rglob('*')))

    def test_tampered_payload_is_rejected_before_creating_repositories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); archive = root/'dataset.tar.gz'; export_dataset(self.root, archive)
            with tarfile.open(archive) as tar: tar.extractall(root, filter='data')
            package = root/'recoder-dataset'; (package/'labels/example-1.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): restore(package, root/'restored')
            self.assertFalse((root/'restored').exists())

    def test_accepted_defects_retain_the_structured_independent_audit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); shutil.copytree(self.root, root/'source')
            data = root/'source/datasets/synth-rebuilt-v1'
            label = dict(self.label, repo=(root/'source/forges/example').as_uri(), defects=[dict(id='d1', kind='bug', file='source.py', line=1, title='Wrong value')])
            (data/'labels/example-1.json').write_text(json.dumps(label))
            manifest = json.loads((data/'manifest.json').read_text())
            manifest['cases']['example-1']['defects'] = dict(d1=dict(accepted=True, independent_audit='gemini-4-neon-medium', audit=dict(reachability='Public API', expected='One', actual='Two', evidence='Static trace')))
            (data/'manifest.json').write_text(json.dumps(manifest))
            archive = root/'dataset.tar.gz'; result = export_dataset(root/'source', archive)
            self.assertEqual(result['defects'], 1)
            with tarfile.open(archive) as tar:
                exported = json.load(tar.extractfile('recoder-dataset/manifest.json'))
            self.assertEqual(exported['cases']['example-1']['defects']['d1']['evidence'], 'Static trace')
            self.assertEqual(exported['cases']['example-1']['defects']['d1']['model'], 'gemini-4-neon-medium')

    def test_paths_and_credential_bearing_origins_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root/'link').symlink_to(root.parent)
            for path in ('../secret', '/etc/passwd', 'link/secret'):
                with self.subTest(path=path), self.assertRaises(ValueError): safe_path(root, path)
        for url in ('https://token:secret@github.com/a/b', 'https://github.com/a/b?token=secret', 'https://elsewhere.test/a/b'):
            with self.subTest(url=url), self.assertRaises(ValueError): public_origin(url)
        with self.assertRaises(ValueError): public_text('-----BEGIN PRIVATE KEY-----')

    def test_empty_publication_and_symlink_labels_are_not_exported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); shutil.copytree(self.root, root/'source')
            data = root/'source/datasets/synth-rebuilt-v1'; label = data/'labels/example-1.json'
            label.unlink(); label.symlink_to(self.root/'datasets/synth-rebuilt-v1/labels/example-1.json')
            with self.assertRaisesRegex(ValueError, 'symlink'): export_dataset(root/'source', root/'one.tar.gz')
            (data/'manifest.json').write_text('{"cases":{}}')
            with self.assertRaisesRegex(ValueError, 'no published'): export_dataset(root/'source', root/'two.tar.gz')

    def final_fixture(self, root):
        shutil.copytree(self.root, root/'source')
        source = root/'source'; final = source/'datasets/final-v1'
        shutil.copytree(source/'datasets/synth-rebuilt-v1', final)
        label = dict(self.label, repo=(source/'forges/example').as_uri())
        continuity = final/'views/continuity/labels'; continuity.mkdir(parents=True)
        (continuity/'example-1.json').write_text(json.dumps(label))
        defect = dict(id='d1', kind='bug', file='source.py', line=1, title='Omission', provenance='audit-omission-confirmed')
        (final/'labels/example-1.json').write_text(json.dumps(dict(label, defects=[defect])))
        manifest = json.loads((final/'manifest.json').read_text())
        manifest['cases']['example-1']['defects'] = dict(d1=dict(accepted=True, method='test', evidence='value is 2'))
        manifest.update(labelViews=dict(primary='.', continuity='views/continuity'),
                        provenance={'example-1': dict(membership=dict(generator='Flash-injected', evaluation='new', repository='tuned-repo'))})
        (final/'manifest.json').write_text(json.dumps(manifest))
        (final/'README.md').write_text('Disclosed overall: reject gate gap')
        (final/'provenance/audits').mkdir(parents=True)
        (final/'provenance/audits/example-1.json').write_text('{"overall":"reject"}')
        inventory = {str(p.relative_to(final)): hashlib.sha256(p.read_bytes()).hexdigest() for p in final.rglob('*') if p.is_file()}
        (final/'SHA256SUMS.json').write_text(json.dumps(inventory))
        return source, final

    def test_final_views_restore_both_denominators_and_preserve_original_audits_and_hashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source, final = self.final_fixture(root)
            archive = root/'final.tar.gz'; export_dataset(source, archive, final)
            with tarfile.open(archive) as tar: tar.extractall(root, filter='data')
            package = root/'recoder-dataset'; restore(package, root/'restored')
            for view, count in (('', 1), ('views/continuity', 0)):
                label = json.loads((root/'restored'/view/'labels/example-1.json').read_text())
                self.assertEqual(len(label['defects']), count)
                self.assertEqual(label['repo'], (root/'restored/repos/example').as_uri())
            manifest = json.loads((package/'manifest.json').read_text())
            self.assertEqual(manifest['viewDefects'], dict(primary=1, continuity=0))
            for path in final.rglob('*'):
                if path.is_file(): self.assertEqual(path.read_bytes(), (package/'frozen/final-v1'/path.relative_to(final)).read_bytes())

    def test_final_inventory_rejects_tampering_unhashed_files_and_unallowlisted_payloads(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); _, final = self.final_fixture(root)
            path = final/'README.md'; original = path.read_bytes(); path.write_text('changed')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): validate_final(final, public_text)
            path.write_bytes(original)
            private = final/'raw-exports.json'; private.write_text('{}')
            with self.assertRaisesRegex(ValueError, 'unhashed'): validate_final(final, public_text)
            inventory = json.loads((final/'SHA256SUMS.json').read_text())
            inventory['raw-exports.json'] = hashlib.sha256(private.read_bytes()).hexdigest()
            (final/'SHA256SUMS.json').write_text(json.dumps(inventory))
            with self.assertRaisesRegex(ValueError, 'unexpected final payload'): validate_final(final, public_text)


if __name__ == '__main__': unittest.main()
