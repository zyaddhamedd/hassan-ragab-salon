"""Omar-only Alembic environment; canonical version files, no Flask factory."""
from alembic import context


config = context.config
connection = config.attributes.get('connection')
if config.attributes.get('omar_guarded') is not True or connection is None:
    raise RuntimeError('Use backend/omar_migrate.py; standalone Alembic invocation is forbidden')
if context.is_offline_mode() or not connection.in_transaction():
    raise RuntimeError('A verified live Omar connection and enclosing transaction are required')

context.configure(connection=connection, target_metadata=None, transaction_per_migration=False)
with context.begin_transaction():
    context.run_migrations()
