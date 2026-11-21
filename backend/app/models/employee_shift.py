"""Employee planning only; unrelated to POS CashierShift or attendance records."""
from datetime import datetime, timezone
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from app.extensions import db


def now():
    return datetime.now(timezone.utc)


class EmployeeShiftTemplate(db.Model):
    __tablename__ = 'employee_shift_templates'
    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='RESTRICT'), nullable=False)
    name = db.Column(db.String(80), nullable=False)
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=False)
    grace_minutes = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (
        db.CheckConstraint('start_time <> end_time', name='ck_employee_shift_nonzero'),
        db.CheckConstraint('grace_minutes BETWEEN 0 AND 120', name='ck_employee_shift_grace'),
    )


class EmployeeWeeklyShift(db.Model):
    __tablename__ = 'employee_weekly_shifts'
    version = db.Column(db.Integer, nullable=False, default=1)
    retired_from = db.Column(db.Date)
    retired_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'))
    retired_at = db.Column(db.DateTime(timezone=True))
    supersedes_id = db.Column(db.Integer, db.ForeignKey('employee_weekly_shifts.id', ondelete='RESTRICT'), unique=True)
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employees.id', ondelete='RESTRICT'), nullable=False, index=True)
    template_id = db.Column(db.Integer, db.ForeignKey('employee_shift_templates.id', ondelete='RESTRICT'), nullable=False)
    weekday = db.Column(db.Integer, nullable=False)  # ISO/Python: Monday=0, Sunday=6.
    effective_from = db.Column(db.Date, nullable=False)
    effective_to = db.Column(db.Date, nullable=False)  # Inclusive, explicit bounded planning period.
    created_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (
        db.CheckConstraint("(version=1 AND retired_from IS NULL AND retired_by IS NULL AND retired_at IS NULL) OR (version=2 AND retired_from IS NOT NULL AND retired_by IS NOT NULL AND retired_at IS NOT NULL)", name='ck_employee_weekly_shifts_lifecycle'),
        db.CheckConstraint('weekday BETWEEN 0 AND 6', name='ck_employee_weekday'),
        db.CheckConstraint('effective_to >= effective_from', name='ck_employee_shift_period'),
        # Native range GiST operators: no btree_gist extension required.
        ExcludeConstraint((db.func.int4range(employee_id, employee_id, '[]'), '&&'),
                          (db.func.int4range(weekday, weekday, '[]'), '&&'),
                          (db.func.daterange(effective_from, db.func.least(effective_to + 1, retired_from), '[)'), '&&'),
                          name='ex_employee_weekly_period').ddl_if(dialect='postgresql'),
    )


class EmployeeShiftOverride(db.Model):
    __tablename__ = 'employee_shift_overrides'
    version = db.Column(db.Integer, nullable=False, default=1)
    retired_from = db.Column(db.Date)
    retired_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'))
    retired_at = db.Column(db.DateTime(timezone=True))
    supersedes_id = db.Column(db.Integer, db.ForeignKey('employee_shift_overrides.id', ondelete='RESTRICT'), unique=True)
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employees.id', ondelete='RESTRICT'), nullable=False)
    shift_date = db.Column(db.Date, nullable=False)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='RESTRICT'), nullable=False)
    is_rest = db.Column(db.Boolean, nullable=False)
    template_id = db.Column(db.Integer, db.ForeignKey('employee_shift_templates.id', ondelete='RESTRICT'))
    created_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (
        db.CheckConstraint("(version=1 AND retired_from IS NULL AND retired_by IS NULL AND retired_at IS NULL) OR (version=2 AND retired_from IS NOT NULL AND retired_by IS NOT NULL AND retired_at IS NOT NULL)", name='ck_employee_shift_overrides_lifecycle'),
        db.Index('uq_employee_shift_override', 'employee_id', 'shift_date', unique=True, postgresql_where=db.text('retired_from IS NULL'), sqlite_where=db.text('retired_from IS NULL')),
        db.CheckConstraint('(is_rest AND template_id IS NULL) OR (NOT is_rest AND template_id IS NOT NULL)', name='ck_employee_shift_override_kind'),
    )


class EmployeeShiftInstance(db.Model):
    __tablename__ = 'employee_shift_instances'
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employees.id', ondelete='RESTRICT'), nullable=False)
    shift_date = db.Column(db.Date, nullable=False)  # Cairo date on which the shift STARTS.
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id', ondelete='RESTRICT'), nullable=False)
    state = db.Column(db.String(12), nullable=False)
    template_id = db.Column(db.Integer, db.ForeignKey('employee_shift_templates.id', ondelete='RESTRICT'))
    template_name = db.Column(db.String(80))
    source = db.Column(db.String(12), nullable=False)
    start_at = db.Column(db.DateTime(timezone=True))
    end_at = db.Column(db.DateTime(timezone=True))
    grace_minutes = db.Column(db.Integer, nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (
        db.UniqueConstraint('employee_id', 'shift_date', name='uq_employee_shift_instance'),
        db.CheckConstraint("state IN ('SCHEDULED','REST','UNASSIGNED')", name='ck_employee_shift_state'),
        db.CheckConstraint("source IN ('WEEKLY','OVERRIDE','NONE')", name='ck_employee_shift_source'),
        db.CheckConstraint('grace_minutes BETWEEN 0 AND 120', name='ck_employee_instance_grace'),
        db.CheckConstraint("(state='SCHEDULED' AND start_at IS NOT NULL AND end_at IS NOT NULL AND end_at > start_at AND template_id IS NOT NULL) OR (state<>'SCHEDULED' AND start_at IS NULL AND end_at IS NULL AND template_id IS NULL)", name='ck_employee_instance_times'),
        ExcludeConstraint((db.func.int4range(employee_id, employee_id, '[]'), '&&'),
                          (db.func.tstzrange(start_at, end_at, '[)'), '&&'),
                          where=db.text("state='SCHEDULED'"), name='ex_employee_instance_overlap').ddl_if(dialect='postgresql'),
    )


class EmployeeShiftChange(db.Model):
    __tablename__='employee_shift_changes'
    id=db.Column(db.Integer,primary_key=True)
    employee_id=db.Column(db.Integer,db.ForeignKey('employees.id',ondelete='RESTRICT'),nullable=False)
    weekly_id=db.Column(db.Integer,db.ForeignKey('employee_weekly_shifts.id',ondelete='RESTRICT'),unique=True)
    override_id=db.Column(db.Integer,db.ForeignKey('employee_shift_overrides.id',ondelete='RESTRICT'),unique=True)
    action=db.Column(db.String(8),nullable=False)
    effective_from=db.Column(db.Date,nullable=False)
    actor_id=db.Column(db.Integer,db.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False)
    reason=db.Column(db.String(200),nullable=False)
    created_at=db.Column(db.DateTime(timezone=True),nullable=False,default=now)
    __table_args__=(db.CheckConstraint('(weekly_id IS NOT NULL AND override_id IS NULL) OR (weekly_id IS NULL AND override_id IS NOT NULL)',name='ck_employee_change_target'),db.CheckConstraint("action IN ('REPLACE','CANCEL')",name='ck_employee_change_action'))
