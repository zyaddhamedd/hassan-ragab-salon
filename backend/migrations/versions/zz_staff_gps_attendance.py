"""Add immutable, coordinate-free Staff attendance proof/idempotency receipts."""
from alembic import op
import sqlalchemy as sa

revision = 'zz_staff_gps_attendance'
down_revision = 'zy_staff_attendance_evidence'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('staff_attendance_receipts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('idempotency_key', sa.String(32), nullable=False),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('action', sa.String(12), nullable=False),
        sa.Column('attendance_id', sa.Integer(), sa.ForeignKey('attendances.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('shift_instance_id', sa.Integer(), sa.ForeignKey('employee_shift_instances.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('geofence_version_id', sa.Integer(), sa.ForeignKey('staff_geofence_versions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('device_id', sa.String(32), sa.ForeignKey('staff_devices.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('challenge_id', sa.String(32), sa.ForeignKey('staff_device_challenges.id', ondelete='RESTRICT'), nullable=False, unique=True),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('user_id', 'idempotency_key', name='uq_staff_attendance_retry'),
        sa.UniqueConstraint('attendance_id', 'action', name='uq_staff_attendance_action'),
        sa.CheckConstraint("action IN ('CHECK_IN','CHECK_OUT')", name='ck_staff_attendance_action'))
    op.execute("""CREATE FUNCTION omar_staff_attendance_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Staff attendance receipts are immutable' USING ERRCODE='23514';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM attendances a
        JOIN users u ON u.id=NEW.user_id AND u.employee_id=a.employee_id
        JOIN employee_shift_instances s ON s.id=NEW.shift_instance_id
          AND s.employee_id=a.employee_id AND s.branch_id=a.branch_id AND s.shift_date=a.date
        JOIN staff_geofence_versions f ON f.id=NEW.geofence_version_id AND f.branch_id=a.branch_id AND f.enabled
        JOIN staff_devices d ON d.id=NEW.device_id AND d.user_id=u.id AND d.employee_id=a.employee_id AND d.state='ACTIVE'
        JOIN staff_device_challenges c ON c.id=NEW.challenge_id AND c.device_id=d.id
          AND c.purpose='request' AND c.method='POST' AND c.consumed_at IS NOT NULL
          AND c.proof_jti IS NOT NULL AND c.token_hash IS NOT NULL
        WHERE a.id=NEW.attendance_id AND a.attendance_origin='STAFF_GPS' AND a.business_day_id IS NULL
          AND ((NEW.action='CHECK_IN' AND a.status='PRESENT' AND a.check_out_time IS NULL
                AND a.check_in_time=NEW.recorded_at AND c.target='/api/staff/attendance/check-in')
            OR (NEW.action='CHECK_OUT' AND a.status='LEFT' AND a.checkout_verification='STAFF_GPS_VERIFIED'
                AND a.check_out_time=NEW.recorded_at AND c.target='/api/staff/attendance/check-out'))
      ) THEN
        RAISE EXCEPTION 'Staff attendance receipt binding mismatch' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$""")
    op.execute('CREATE TRIGGER staff_attendance_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON staff_attendance_receipts FOR EACH ROW EXECUTE FUNCTION omar_staff_attendance_receipt_guard()')
    op.execute("""CREATE FUNCTION omar_staff_attendance_anchor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS(SELECT 1 FROM staff_attendance_receipts WHERE attendance_id=OLD.id)
         AND ROW(NEW.id,NEW.employee_id,NEW.branch_id,NEW.date,NEW.check_in_time,NEW.business_day_id)
             IS DISTINCT FROM ROW(OLD.id,OLD.employee_id,OLD.branch_id,OLD.date,OLD.check_in_time,OLD.business_day_id) THEN
        RAISE EXCEPTION 'Staff check-in anchor is immutable' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$""")
    op.execute('CREATE TRIGGER staff_attendance_anchor_guard BEFORE UPDATE ON attendances FOR EACH ROW EXECUTE FUNCTION omar_staff_attendance_anchor_guard()')


def downgrade():
    if op.get_bind().execute(sa.text('SELECT EXISTS(SELECT 1 FROM staff_attendance_receipts)')).scalar():
        raise RuntimeError('Refusing to discard Staff attendance proof receipts.')
    op.execute('DROP TRIGGER staff_attendance_anchor_guard ON attendances')
    op.execute('DROP FUNCTION omar_staff_attendance_anchor_guard()')
    op.drop_table('staff_attendance_receipts')
    op.execute('DROP FUNCTION omar_staff_attendance_receipt_guard()')
