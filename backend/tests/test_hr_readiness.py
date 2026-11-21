"""Offline graph and startup-contract tests; never construct a Flask app."""
import builtins
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
import hr_local

spec = importlib.util.spec_from_file_location('hr_migration_audit', ROOT / 'local/hassan/audit_migrations.py')
migration_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration_audit)


class ReadinessTests(unittest.TestCase):
    def test_complete_active_graph(self):
        result = migration_audit.audit()
        self.assertEqual(result['count'], 65)
        self.assertEqual(result['roots'], ['9a1b321acf1c'])
        self.assertEqual(result['heads'], ['zz_staff_gps_attendance'])
        self.assertEqual(len(result['merges']), 4)
        positions = {r: i for i, r in enumerate(result['topological_order'])}
        for revision, node in result['revisions'].items():
            for parent in migration_audit.references(node['down_revision']):
                self.assertLess(positions[parent], positions[revision])

    def test_graph_rejects_missing_duplicate_and_cycle(self):
        for sources in [
            [('a', 'missing')], [('a', None), ('a', None)], [('a', 'b'), ('b', 'a')]
        ]:
            with self.subTest(sources=sources), tempfile.TemporaryDirectory() as directory:
                for i, (revision, parent) in enumerate(sources):
                    (Path(directory) / f'{i}.py').write_text(
                        f'revision = {revision!r}\ndown_revision = {parent!r}\n'
                    )
                with self.assertRaises(ValueError):
                    migration_audit.audit(Path(directory))

    def test_start_contract_with_stubs_only(self):
        settings = dict(hr_local.FIXED,
                        DATABASE_URL='postgresql://hassan_ragab_local:offline-only@127.0.0.1:55433/hassan_ragab_local',
                        SECRET_KEY=secrets.token_hex(32), JWT_SECRET_KEY=secrets.token_hex(32))
        fake_app = SimpleNamespace(run=Mock())
        fake_config = SimpleNamespace(SQLALCHEMY_ENGINE_OPTIONS={
            'pool_size': 10, 'max_overflow': 10, 'pool_pre_ping': True
        })
        original_import = builtins.__import__
        imports = []

        def safe_import(name, *args, **kwargs):
            if name == 'app':
                imports.append(name)
                self.assertEqual(dict(os.environ), settings)
                return SimpleNamespace(create_app=factory)
            if name == 'app.config':
                return SimpleNamespace(Config=fake_config)
            if name.split('.')[0] in {'flask', 'psycopg2', 'dotenv'}:
                raise AssertionError('Real runtime import forbidden')
            return original_import(name, *args, **kwargs)

        def create(**kwargs):
            self.assertEqual(kwargs, {'bootstrap': False})
            self.assertEqual(fake_config.SQLALCHEMY_DATABASE_URI.drivername, 'postgresql+psycopg2')
            self.assertEqual(fake_config.SQLALCHEMY_DATABASE_URI.host, '127.0.0.1')
            self.assertEqual(fake_config.SQLALCHEMY_DATABASE_URI.port, 55433)
            self.assertIs(fake_config.MINI_LEGACY_DEVICE_COMPATIBILITY_ENABLED, False)
            self.assertIs(fake_config.MINI_PROOF_ENROLLMENT_REQUIRED, True)
            return fake_app

        factory = Mock(side_effect=create)
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'backend.json'
            config.write_text(json.dumps(settings))
            with patch.dict(os.environ, {'DATABASE_URL': 'forbidden-inherited-value',
                                         'CLOUDINARY_URL': 'forbidden', 'FLASK_APP': 'run.py'}), \
                    patch.object(sys, 'argv', ['hr_local.py', '--config', str(config), '--start']), \
                    patch('builtins.__import__', side_effect=safe_import), \
                    patch.object(socket.socket, 'connect', side_effect=AssertionError('No connection allowed')), \
                    contextlib.redirect_stdout(io.StringIO()):
                hr_local.main()
        self.assertEqual(imports, ['app'])
        factory.assert_called_once_with(bootstrap=False)
        fake_app.run.assert_called_once_with(host='127.0.0.1', port=5204, debug=False,
                                             use_reloader=False, load_dotenv=False)
        self.assertEqual(fake_config.SQLALCHEMY_ENGINE_OPTIONS,
                         {'pool_size': 5, 'max_overflow': 0, 'pool_pre_ping': True})
        self.assertEqual(fake_config.API_CORS_ALLOWED_ORIGINS,
                         ('http://127.0.0.1:3200', 'http://127.0.0.1:5276'))
        contract = json.loads((ROOT / 'local/hassan/frontend-contract.json').read_text())
        self.assertEqual(fake_config.API_CORS_ALLOWED_ORIGINS,
                         (contract['admin']['origin'], contract['mini']['origin']))
        self.assertEqual(fake_config.MINI_PROOF_ALLOWED_API_BASE_URLS,
                         (contract['backend'], contract['admin']['origin'], contract['mini']['origin']))
        self.assertEqual(fake_config.SESSION_COOKIE_NAME, contract['cookies']['session'])
        self.assertEqual(fake_config.MINI_DEVICE_COOKIE_NAME, contract['cookies']['miniDevice'])
        self.assertEqual(fake_config.MINI_ENROLLMENT_PROOF_COOKIE_NAME, contract['cookies']['miniEnrollment'])

    def test_invalid_start_rejected_before_application_import(self):
        original_import = builtins.__import__

        def guarded(name, *args, **kwargs):
            if name.split('.')[0] in {'app', 'flask', 'sqlalchemy', 'psycopg2', 'dotenv'}:
                raise AssertionError('Runtime import forbidden')
            return original_import(name, *args, **kwargs)

        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'backend.json'
            config.write_text('{}')
            with patch.object(sys, 'argv', ['hr_local.py', '--config', str(config), '--start']), \
                    patch('builtins.__import__', side_effect=guarded), \
                    contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as result:
                    hr_local.main()
            self.assertEqual(result.exception.code, 2)


if __name__ == '__main__':
    unittest.main()
