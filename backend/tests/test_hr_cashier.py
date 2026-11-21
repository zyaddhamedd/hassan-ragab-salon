"""Offline duplicate guards for the explicit local cashier HTTP provisioning tool."""
import importlib.util
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('hr_cashier',
    Path(__file__).resolve().parents[2] / 'local/hassan/provision-cashier.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CashierGuardTests(unittest.TestCase):
    def test_existing_credentials_refuse_before_any_query(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'cashier.json'
            path.write_text('{}')
            connection = Mock()
            with self.assertRaises(RuntimeError):
                module.check_empty(connection, path)
            connection.execute.assert_not_called()

    def test_existing_employee_user_or_wrong_role_refuses(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(socket.socket, 'connect', side_effect=AssertionError('No network')):
            for employee_count, user_count, roles in [(1, 1, ['SUPER_ADMIN']),
                    (0, 2, ['SUPER_ADMIN', 'CASHIER']), (0, 1, ['CASHIER'])]:
                connection = Mock()
                connection.execute.side_effect = [Mock(scalar=Mock(return_value=employee_count)),
                    Mock(scalar=Mock(return_value=user_count)),
                    Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=roles))))]
                with self.subTest(employee_count=employee_count, roles=roles), self.assertRaises(RuntimeError):
                    module.check_empty(connection, Path(directory) / 'absent.json')


if __name__ == '__main__':
    unittest.main()
