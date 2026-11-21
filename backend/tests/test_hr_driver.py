"""Real SQLAlchemy/DBAPI resolution, with all connection attempts forbidden."""
from pathlib import Path
import secrets
import socket
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hr_local


class DriverTests(unittest.TestCase):
    def setUp(self):
        self.settings = dict(hr_local.FIXED,
            DATABASE_URL='postgresql://hassan_ragab_local:offline-only@127.0.0.1:55433/hassan_ragab_local',
            SECRET_KEY=secrets.token_hex(32), JWT_SECRET_KEY=secrets.token_hex(32))

    def test_runtime_engine_uses_importable_psycopg2_without_connecting(self):
        from sqlalchemy import create_engine
        from sqlalchemy.engine import make_url
        from sqlalchemy.pool import NullPool
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')), \
                patch('psycopg2.connect', side_effect=AssertionError('DB connection forbidden')) as connect:
            url = hr_local.runtime_database_url(self.settings)
            self.assertEqual(url, make_url(self.settings['DATABASE_URL']).set(drivername='postgresql+psycopg2'))
            engine = create_engine(url, poolclass=NullPool)
            try:
                self.assertEqual(engine.dialect.driver, 'psycopg2')
                self.assertEqual(engine.dialect.dbapi.__name__, 'psycopg2')
            finally:
                engine.dispose()
            connect.assert_not_called()

    def test_driver_selection_cannot_bypass_target_guard(self):
        original = self.settings['DATABASE_URL']
        invalid = [original.replace('55433', '5432'), original.replace('127.0.0.1', 'production.example'),
                   original.replace('/hassan_ragab_local', '/other'),
                   original.replace('hassan_ragab_local:', 'other:'),
                   original.replace('postgresql:', 'postgresql+psycopg2:'),
                   original + '?host=production.example']
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')), \
                patch('psycopg2.connect', side_effect=AssertionError('DB connection forbidden')):
            for url in invalid:
                with self.subTest(target=url), self.assertRaises(ValueError):
                    hr_local.runtime_database_url(dict(self.settings, DATABASE_URL=url))


if __name__ == '__main__':
    unittest.main()
