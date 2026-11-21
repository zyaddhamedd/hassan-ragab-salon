"""Isolated historical recovery read model; no operational row changes."""
from alembic import op
import sqlalchemy as sa

revision = 'zl_stock_recovery_read_model'
down_revision = 'zk_stock_balance_snapshots'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('stock_recovery_runs',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('algorithm_version', sa.String(32), nullable=False),
        sa.Column('snapshot_identity', sa.JSON(), nullable=False),
        sa.Column('snapshot_fingerprint', sa.String(64), nullable=False),
        sa.Column('generated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('imported_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('approved_preview', sa.String(64), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False))
    op.create_table('stock_movement_recoveries',
        sa.Column('movement_id', sa.Integer(), primary_key=True),
        sa.Column('run_id', sa.String(64), sa.ForeignKey('stock_recovery_runs.id'), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False), sa.Column('branch_id', sa.Integer(), nullable=False),
        sa.Column('movement_fingerprint', sa.String(64), nullable=False),
        sa.Column('category', sa.String(1), nullable=False),
        sa.Column('balance_before', sa.Integer()), sa.Column('quantity_delta', sa.Integer()), sa.Column('balance_after', sa.Integer()),
        sa.Column('segment_id', sa.String(120), nullable=False), sa.Column('evidence_group', sa.String(120), nullable=False),
        sa.Column('sequence', sa.Integer(), nullable=False), sa.Column('anchor_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('assumptions', sa.JSON(), nullable=False), sa.Column('unavailable_reason', sa.String(120)),
        sa.CheckConstraint("category IN ('B','C','D')", name='ck_recovery_category'),
        sa.CheckConstraint('sequence > 0', name='ck_recovery_sequence'),
        sa.CheckConstraint("(category = 'D' AND balance_before IS NULL AND balance_after IS NULL AND unavailable_reason IS NOT NULL) OR "
                           "(category IN ('B','C') AND balance_before IS NOT NULL AND quantity_delta IS NOT NULL AND balance_after IS NOT NULL "
                           "AND balance_before >= 0 AND balance_after >= 0 AND balance_after = balance_before + quantity_delta)", name='ck_recovery_balance'))
    op.create_index('ix_stock_movement_recoveries_run_id', 'stock_movement_recoveries', ['run_id'])
    op.create_table('stock_recovery_evidence',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('run_id', sa.String(64), sa.ForeignKey('stock_recovery_runs.id'), nullable=False),
        sa.Column('evidence_group', sa.String(120), nullable=False), sa.Column('first_sequence', sa.Integer(), nullable=False),
        sa.Column('source_table', sa.String(60), nullable=False), sa.Column('source_id', sa.Integer(), nullable=False),
        sa.Column('expected', sa.JSON(), nullable=False),
        sa.UniqueConstraint('run_id', 'evidence_group', 'source_table', 'source_id', name='uq_recovery_evidence_source'))
    op.create_index('ix_recovery_evidence_prefix', 'stock_recovery_evidence', ['run_id', 'evidence_group', 'first_sequence', 'source_table'])


def downgrade():
    # Retain reviewed provenance on application rollback; a metadata purge needs
    # a separate explicit operator decision, never an automatic downgrade.
    if op.get_bind().execute(sa.text('SELECT 1 FROM stock_recovery_runs LIMIT 1')).first():
        raise RuntimeError('Recovery provenance exists; disable the feature and retain the additive schema.')
    op.drop_table('stock_recovery_evidence')
    op.drop_table('stock_movement_recoveries')
    op.drop_table('stock_recovery_runs')
