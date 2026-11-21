"""Offline guard tests; no real connection, migration or application import."""
import contextlib
import io
from pathlib import Path
import runpy
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hr_migrate


class MigrationGuardTests(unittest.TestCase):
    def test_exact_server_and_owner_identity(self):
        identity = ['127.0.0.1', 55433, 'hassan_ragab_local', 'hassan_ragab_local',
                    'hassan_ragab_local', 100, 'hassan_ragab_local', 160015]
        for field, value in [(None, None), (0, '127.0.0.2'), (1, 5432),
                             (2, 'other'), (3, 'other'), (4, 'other'),
                             (5, 999), (6, 'other'), (7, 170000)]:
            row = list(identity)
            if field is not None:
                row[field] = value
            connection = Mock()
            connection.execute.side_effect = [Mock(one=Mock(return_value=tuple(row))),
                Mock(one=Mock(return_value=(False,)*5)), Mock(scalar=Mock(return_value=True)),
                Mock(scalar=Mock(return_value=True))]
            with self.subTest(field=field):
                if field is None:
                    hr_migrate.verify_identity(connection, 100)
                else:
                    with self.assertRaises(RuntimeError):
                        hr_migrate.verify_identity(connection, 100)

    def test_identity_and_nonempty_fail_before_migration(self):
        settings = {'DATABASE_URL': 'postgresql://hassan_ragab_local:offline@127.0.0.1:55433/hassan_ragab_local'}
        for failure in ('identity', 'nonempty'):
            engine = Mock()
            transaction = contextlib.nullcontext(Mock())
            engine.begin.return_value = transaction
            with self.subTest(failure=failure), \
                    patch('sqlalchemy.create_engine', return_value=engine), \
                    patch.object(hr_migrate, 'verify_identity', side_effect=RuntimeError('wrong identity') if failure == 'identity' else None), \
                    patch.object(hr_migrate, 'verify_empty', side_effect=RuntimeError('not empty') if failure == 'nonempty' else None), \
                    patch('alembic.command.upgrade') as upgrade:
                with self.assertRaises(RuntimeError):
                    hr_migrate.execute(settings, 1, True)
                upgrade.assert_not_called()
                engine.begin.assert_not_called()

    def test_check_mode_never_upgrades(self):
        engine = Mock()
        engine.begin.return_value = contextlib.nullcontext(Mock())
        with patch('sqlalchemy.create_engine', return_value=engine) as create, \
                patch.object(hr_migrate, 'verify_identity'), patch.object(hr_migrate, 'verify_empty'), \
                patch('alembic.command.upgrade') as upgrade, contextlib.redirect_stdout(io.StringIO()):
            result = hr_migrate.execute({'DATABASE_URL': 'postgresql://hassan_ragab_local:offline@127.0.0.1:55433/hassan_ragab_local'}, 1, False)
        upgrade.assert_not_called()
        self.assertEqual(result['status'], 'preflight_passed')
        self.assertEqual(create.call_args.kwargs['connect_args']['require_auth'], 'scram-sha-256')

    def test_standalone_alembic_environment_rejected(self):
        context = SimpleNamespace(config=SimpleNamespace(attributes={}))
        with patch.dict(sys.modules, {'alembic': SimpleNamespace(context=context)}):
            with self.assertRaisesRegex(RuntimeError, 'standalone'):
                runpy.run_path(str(hr_migrate.WORKSPACE / 'local/hassan/alembic/env.py'))

    def test_log_redacts_credentials(self):
        stream = io.StringIO()
        log = hr_migrate.RedactedLog(stream, ['private-password', 'private-secret'])
        log.write('error private-password private-secret')
        self.assertEqual(stream.getvalue(), 'error <redacted> <redacted>')

    def test_result_inventory_includes_required_domain_tables(self):
        tables = hr_migrate.expected_tables()
        self.assertTrue({'users', 'branches', 'customers', 'employees', 'invoices', 'business_days',
                         'payroll_settlements', 'return_item_valuations', 'alembic_version'} <= tables)


if __name__ == '__main__':
    unittest.main()
