"""Offline initialization safety checks. No live DB, factory or server."""
import contextlib
import io
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hr_initialize


class InitializerTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(socket.socket, 'connect', side_effect=AssertionError('No network')))
        self.stack.enter_context(patch('psycopg2.connect', side_effect=AssertionError('No database')))

    def test_first_time_rejects_existing_users_or_branches(self):
        for counts in [(1, 0), (0, 1), (1, 1)]:
            connection = Mock()
            connection.execute.return_value.one.return_value = counts
            with self.subTest(counts=counts), patch.object(hr_initialize, 'verify_result') as verify:
                with self.assertRaises(hr_initialize.AlreadyInitialized):
                    hr_initialize.first_time(connection)
                verify.assert_not_called()

    def test_first_time_requires_migrated_seed_state(self):
        connection = Mock()
        connection.execute.return_value.one.return_value = (0, 0)
        with patch.object(hr_initialize, 'verify_result', side_effect=RuntimeError('bad head/seed')):
            with self.assertRaises(RuntimeError):
                hr_initialize.first_time(connection)

    def test_existing_models_and_password_hashing(self):
        from app.models import UserRole
        session = Mock()
        password = 'offline-fixture-only-not-a-real-account-password'
        hr_initialize.create_records(session, password, 'offline@example.invalid')
        branch, user = session.add_all.call_args.args[0]
        self.assertEqual((branch.name, branch.city, branch.is_main_warehouse, branch.is_active),
                         ('Hassan Ragab Salon', 'Giza', False, True))
        self.assertTrue(branch.allow_discounts)
        self.assertEqual(user.role, UserRole.SUPER_ADMIN)
        self.assertIsNone(user.branch_id)
        self.assertTrue(user.is_active)
        self.assertNotEqual(user.password_hash, password)
        self.assertTrue(user.check_password(password))
        self.assertFalse(user.check_password('incorrect'))
        session.flush.assert_called_once()
        session.commit.assert_not_called()

    def test_private_file_is_exclusive_owner_only_and_no_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            output = root / 'credentials.json'
            with patch.object(hr_initialize, 'PRIVATE', root):
                hr_initialize.write_private(output, {'password': 'offline-test-only'})
                self.assertEqual(output.stat().st_mode & 0o777, 0o600)
                original = output.read_bytes()
                with self.assertRaises(FileExistsError):
                    hr_initialize.write_private(output, {'password': 'replacement'})
                self.assertEqual(output.read_bytes(), original)
                link = root / 'symlink.json'
                link.symlink_to(output)
                with self.assertRaises(OSError):
                    hr_initialize.write_private(link, {})
                self.assertEqual(output.read_bytes(), original)

    def test_apply_failure_rolls_back_before_records_or_credentials(self):
        engine = Mock()
        session = Mock()
        session.__enter__ = Mock(return_value=session)
        session.__exit__ = Mock(return_value=False)
        transaction = Mock()
        transaction.__enter__ = Mock(return_value=transaction)
        transaction.__exit__ = Mock(return_value=False)
        session.begin.return_value = transaction
        with patch.object(hr_initialize, 'engine_for', return_value=engine), \
                patch('sqlalchemy.orm.Session', return_value=session), \
                patch.object(hr_initialize, 'verify_identity'), \
                patch.object(hr_initialize, 'first_time', side_effect=hr_initialize.AlreadyInitialized()), \
                patch.object(hr_initialize, 'write_private') as write, \
                patch.object(hr_initialize, 'create_records') as create:
            with self.assertRaises(hr_initialize.AlreadyInitialized):
                hr_initialize.execute({}, 1, 'apply')
        write.assert_not_called()
        create.assert_not_called()
        self.assertIs(transaction.__exit__.call_args.args[0], hr_initialize.AlreadyInitialized)
        engine.dispose.assert_called_once()

    def test_cli_refusal_does_not_output_credentials_or_write(self):
        with patch.object(sys, 'argv', ['hr_initialize.py', '--config', '.local/hassan/backend.json', '--apply']), \
                patch.object(hr_initialize, 'prepare', return_value=({}, 1)), \
                patch.object(hr_initialize, 'execute', side_effect=hr_initialize.AlreadyInitialized('secret-not-to-echo')), \
                patch.object(hr_initialize, 'write_private') as write, contextlib.redirect_stderr(io.StringIO()) as out:
            with self.assertRaises(SystemExit) as result:
                hr_initialize.main()
        self.assertEqual(result.exception.code, 3)
        self.assertNotIn('secret-not-to-echo', out.getvalue())
        write.assert_not_called()


if __name__ == '__main__':
    unittest.main()
