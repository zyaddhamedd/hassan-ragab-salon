"""create_dedicated_main_warehouse

Revision ID: n2_main_warehouse_setup
Revises: m1_product_commission
Create Date: 2026-06-21 18:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'n2_main_warehouse_setup'
down_revision = 'm1_product_commission'
branch_labels = None
depends_on = None


MAIN_WAREHOUSE_NAME = 'Main Warehouse'


def upgrade():
    connection = op.get_bind()

    branches = sa.table(
        'branches',
        sa.column('id', sa.Integer),
        sa.column('name', sa.String),
        sa.column('city', sa.String),
        sa.column('is_active', sa.Boolean),
        sa.column('is_main_warehouse', sa.Boolean),
        sa.column('allow_discounts', sa.Boolean),
        sa.column('created_at', sa.DateTime(timezone=True)),
        sa.column('updated_at', sa.DateTime(timezone=True)),
    )

    main_branch_id = connection.execute(
        sa.select(branches.c.id).where(branches.c.name == MAIN_WAREHOUSE_NAME)
    ).scalar()

    if main_branch_id is None:
        main_branch_id = connection.execute(
            sa.insert(branches)
            .values(
                name=MAIN_WAREHOUSE_NAME,
                city='Cairo',
                is_active=True,
                is_main_warehouse=True,
                allow_discounts=False,
                created_at=sa.func.now(),
                updated_at=sa.func.now(),
            )
            .returning(branches.c.id)
        ).scalar_one()
    else:
        connection.execute(
            sa.update(branches)
            .where(branches.c.id == main_branch_id)
            .values(
                is_active=True,
                is_main_warehouse=True,
                allow_discounts=False,
                updated_at=sa.func.now(),
            )
        )

    connection.execute(
        sa.update(branches)
        .where(branches.c.id != main_branch_id)
        .values(is_main_warehouse=False, updated_at=sa.func.now())
    )

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_single_main_warehouse
        ON branches (is_main_warehouse)
        WHERE is_main_warehouse = true
        """
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS uq_single_main_warehouse")
