"""Add Staff attendance provenance and immutable unverified closure evidence.

No historical updates. The existing attendance table/open-row index is retained.
"""
from alembic import op
import sqlalchemy as sa

revision = 'zy_staff_attendance_evidence'
down_revision = 'zx_staff_geofence_versions'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('attendances', sa.Column('attendance_origin', sa.String(24), nullable=True))
    op.add_column('attendances', sa.Column('checkout_verification', sa.String(24), nullable=True))
    op.add_column('attendances', sa.Column('closure_actor_id', sa.Integer(), nullable=True))
    op.add_column('attendances', sa.Column('closure_reason', sa.String(200), nullable=True))
    op.add_column('attendances', sa.Column('closure_recorded_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('attendances', sa.Column('closure_review_required', sa.Boolean(), nullable=True))
    op.create_foreign_key('fk_attendance_closure_actor', 'attendances', 'users', ['closure_actor_id'], ['id'], ondelete='RESTRICT')
    # Keep model/migration constraints identical without importing runtime models.
    op.create_check_constraint('ck_attendance_origin', 'attendances',
        "attendance_origin IS NULL OR attendance_origin IN ('LEGACY_CASHIER','STAFF_GPS')")
    op.create_check_constraint('ck_attendance_verification', 'attendances',
        "checkout_verification IS NULL OR checkout_verification IN ('ADMIN_UNVERIFIED','STAFF_GPS_VERIFIED')")
    op.create_check_constraint('ck_attendance_closure_evidence', 'attendances', """
            (checkout_verification IS NULL AND closure_actor_id IS NULL AND closure_reason IS NULL
             AND closure_recorded_at IS NULL AND closure_review_required IS NULL
             AND (attendance_origin IS NULL OR attendance_origin <> 'STAFF_GPS' OR check_out_time IS NULL))
            OR (attendance_origin = 'STAFF_GPS' AND attendance_origin IS NOT NULL
                AND checkout_verification IS NOT NULL AND check_out_time IS NOT NULL AND status = 'LEFT'
                AND ((checkout_verification = 'ADMIN_UNVERIFIED' AND checkout_source = 'ADMIN_CORRECTION'
                      AND checkout_source IS NOT NULL AND closure_actor_id IS NOT NULL
                      AND closure_reason IS NOT NULL AND length(trim(closure_reason)) BETWEEN 1 AND 200
                      AND closure_recorded_at IS NOT NULL AND closure_review_required IS TRUE)
                     OR (checkout_verification = 'STAFF_GPS_VERIFIED' AND closure_actor_id IS NULL
                         AND closure_reason IS NULL AND closure_recorded_at IS NULL AND closure_review_required IS NULL)))
    """)
    op.execute("""CREATE FUNCTION omar_attendance_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.attendance_origin = 'STAFF_GPS' THEN
          RAISE EXCEPTION 'Staff attendance history cannot be deleted' USING ERRCODE='23514';
        END IF;
        RETURN OLD;
      END IF;
      IF NEW.attendance_origin IS DISTINCT FROM OLD.attendance_origin THEN
        RAISE EXCEPTION 'Attendance origin is immutable' USING ERRCODE='23514';
      END IF;
      IF OLD.attendance_origin = 'STAFF_GPS' AND OLD.check_out_time IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Closed Staff attendance evidence is immutable' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$""")
    op.execute('CREATE TRIGGER attendance_evidence_guard BEFORE UPDATE OR DELETE ON attendances FOR EACH ROW EXECUTE FUNCTION omar_attendance_evidence_guard()')


def downgrade():
    if op.get_bind().execute(sa.text("""SELECT EXISTS(SELECT 1 FROM attendances
        WHERE attendance_origin IS NOT NULL OR checkout_verification IS NOT NULL
           OR closure_actor_id IS NOT NULL OR closure_reason IS NOT NULL
           OR closure_recorded_at IS NOT NULL OR closure_review_required IS NOT NULL)""")).scalar():
        raise RuntimeError('Refusing to discard attendance provenance or closure evidence.')
    op.execute('DROP TRIGGER attendance_evidence_guard ON attendances')
    op.execute('DROP FUNCTION omar_attendance_evidence_guard()')
    for name in ('ck_attendance_closure_evidence', 'ck_attendance_verification', 'ck_attendance_origin'):
        op.drop_constraint(name, 'attendances', type_='check')
    op.drop_constraint('fk_attendance_closure_actor', 'attendances', type_='foreignkey')
    for name in ('closure_review_required', 'closure_recorded_at', 'closure_reason', 'closure_actor_id', 'checkout_verification', 'attendance_origin'):
        op.drop_column('attendances', name)
