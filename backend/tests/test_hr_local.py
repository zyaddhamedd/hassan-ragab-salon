"""Offline safety tests: application/DB imports and socket connections are forbidden."""
import builtins
import contextlib
import io
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hr_local


class PreflightTests(unittest.TestCase):
    def setUp(self):
        original = builtins.__import__

        def guarded(name, *args, **kwargs):
            if name.split('.')[0] in {'app', 'flask', 'sqlalchemy', 'psycopg2', 'dotenv'}:
                raise AssertionError('Forbidden application/database import: ' + name)
            return original(name, *args, **kwargs)

        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch('builtins.__import__', side_effect=guarded))
        stack.enter_context(patch.object(socket.socket, 'connect', side_effect=AssertionError('No network allowed')))
        self.settings = dict(hr_local.FIXED, DATABASE_URL=(
            'postgresql://hassan_ragab_local:harmless-test-only@127.0.0.1:55433/hassan_ragab_local'
        ), SECRET_KEY=secrets.token_hex(32), JWT_SECRET_KEY=secrets.token_hex(32))

    def test_valid(self):
        self.assertEqual(hr_local.validate(self.settings), self.settings)

    def test_missing_and_wrong_targets(self):
        for url in ('', 'sqlite:///hr.db',
                    self.settings['DATABASE_URL'].replace('127.0.0.1', 'localhost'),
                    self.settings['DATABASE_URL'].replace('/hassan_ragab_local', '/other'),
                    self.settings['DATABASE_URL'].replace('55433', '5433'),
                    self.settings['DATABASE_URL'].replace('55433', '5432'),
                    self.settings['DATABASE_URL'].replace('hassan_ragab_local:', 'other:'),
                    self.settings['DATABASE_URL'] + '?host=production.example',
                    self.settings['DATABASE_URL'] + '#fragment',
                    'postgresql://hassan_ragab_local:x@production.example:55433/hassan_ragab_local',
                    'postgresql://hassan_ragab_local:x@127.0.0.1:55433/production',
                    'postgresql://hassan_ragab_local:x@127.0.0.1:invalid/hassan_ragab_local'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                hr_local.validate(dict(self.settings, DATABASE_URL=url))
        missing = dict(self.settings)
        del missing['DATABASE_URL']
        with self.assertRaises(ValueError):
            hr_local.validate(missing)

    def test_unsafe_runtime_settings(self):
        for key, value in [('ENABLE_DEV_ROUTES', 'true'), ('FLASK_ENV', 'production'),
                           ('UPLOAD_FOLDER', '/tmp/shared'), ('PORT', '5004'),
                           ('SECRET_KEY', ''), ('JWT_SECRET_KEY', self.settings['SECRET_KEY']),
                           ('CLOUDINARY_API_KEY', 'forbidden')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                hr_local.validate(dict(self.settings, **{key: value}))

    def test_default_cli_ignores_inherited_service_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'config.json'
            config.write_text(json.dumps(self.settings))
            with patch.dict(os.environ, {'DATABASE_URL': 'postgresql://production.example/live',
                                         'CLOUDINARY_API_KEY': 'must-not-be-used'}):
                before = dict(os.environ)
                with patch.object(sys, 'argv', ['hr_local.py', '--config', str(config)]), contextlib.redirect_stdout(io.StringIO()):
                    hr_local.main()
                self.assertEqual(dict(os.environ), before)

    def test_template_fails_closed(self):
        template = hr_local.WORKSPACE / 'local/hassan/backend.example.json'
        with self.assertRaises(ValueError):
            hr_local.validate(json.loads(template.read_text()))

    def test_cli_rejects_without_echoing_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'bad.json'
            config.write_text('{secret-marker')
            output = io.StringIO()
            with patch.object(sys, 'argv', ['hr_local.py', '--config', str(config)]), contextlib.redirect_stderr(output):
                with self.assertRaises(SystemExit) as result:
                    hr_local.main()
            self.assertEqual(result.exception.code, 2)
            self.assertNotIn('secret-marker', output.getvalue())


if __name__ == '__main__':
    unittest.main()
