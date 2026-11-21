"""Versioned disabled-by-default salon geofence configuration; no seed or GPS data."""
from alembic import op
import sqlalchemy as sa
revision='zx_staff_geofence_versions'
down_revision='zw_employee_shift_supersession'
branch_labels=None
depends_on=None


def upgrade():
    op.create_table('staff_geofence_versions',
        sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('branch_id',sa.Integer(),sa.ForeignKey('branches.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('version',sa.Integer(),nullable=False),
        sa.Column('latitude',sa.Float(),nullable=False),sa.Column('longitude',sa.Float(),nullable=False),
        sa.Column('radius_m',sa.Float()),sa.Column('max_accuracy_m',sa.Float()),sa.Column('max_age_seconds',sa.Integer()),
        sa.Column('enabled',sa.Boolean(),nullable=False,server_default=sa.false()),
        sa.Column('actor_id',sa.Integer(),sa.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('reason',sa.String(200),nullable=False),sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
        sa.UniqueConstraint('branch_id','version',name='uq_staff_geofence_branch_version'),
        sa.CheckConstraint('version>0',name='ck_staff_geofence_version'),
        sa.CheckConstraint('latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180',name='ck_staff_geofence_coordinates'),
        sa.CheckConstraint("radius_m IS NULL OR (radius_m>0 AND radius_m<'Infinity')",name='ck_staff_geofence_radius'),
        sa.CheckConstraint("max_accuracy_m IS NULL OR (max_accuracy_m>0 AND max_accuracy_m<'Infinity')",name='ck_staff_geofence_accuracy'),
        sa.CheckConstraint('max_age_seconds IS NULL OR max_age_seconds BETWEEN 1 AND 300',name='ck_staff_geofence_age'),
        sa.CheckConstraint('NOT enabled OR (radius_m IS NOT NULL AND max_accuracy_m IS NOT NULL AND max_age_seconds IS NOT NULL AND max_accuracy_m<=radius_m)',name='ck_staff_geofence_complete'))
    op.execute("""CREATE FUNCTION omar_geofence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Create a new geofence configuration version' USING ERRCODE='23514'; END $$""")
    op.execute('CREATE TRIGGER immutable_staff_geofence BEFORE UPDATE OR DELETE ON staff_geofence_versions FOR EACH ROW EXECUTE FUNCTION omar_geofence_immutable()')


def downgrade():
    if op.get_bind().execute(sa.text('SELECT EXISTS(SELECT 1 FROM staff_geofence_versions)')).scalar():
        raise RuntimeError('Refusing to delete geofence configuration history.')
    op.drop_table('staff_geofence_versions')
    op.execute('DROP FUNCTION omar_geofence_immutable()')
