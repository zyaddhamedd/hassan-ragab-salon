"""Add employee planning only; no attendance backfill or CashierShift changes."""
from alembic import op
import sqlalchemy as sa
revision='zv_employee_shift_planning'
down_revision='zu_staff_personal_devices'
branch_labels=None
depends_on=None


def upgrade():
    op.execute("""
CREATE TABLE employee_shift_templates (
	id SERIAL NOT NULL, 
	branch_id INTEGER NOT NULL, 
	name VARCHAR(80) NOT NULL, 
	start_time TIME WITHOUT TIME ZONE NOT NULL, 
	end_time TIME WITHOUT TIME ZONE NOT NULL, 
	grace_minutes INTEGER NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_by INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_employee_shift_nonzero CHECK (start_time <> end_time), 
	CONSTRAINT ck_employee_shift_grace CHECK (grace_minutes BETWEEN 0 AND 120), 
	FOREIGN KEY(branch_id) REFERENCES branches (id) ON DELETE RESTRICT, 
	FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE RESTRICT
)
    """)
    op.execute("""
CREATE TABLE employee_weekly_shifts (
	id SERIAL NOT NULL, 
	employee_id INTEGER NOT NULL, 
	template_id INTEGER NOT NULL, 
	weekday INTEGER NOT NULL, 
	effective_from DATE NOT NULL, 
	effective_to DATE NOT NULL, 
	created_by INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_employee_weekday CHECK (weekday BETWEEN 0 AND 6), 
	CONSTRAINT ck_employee_shift_period CHECK (effective_to >= effective_from), 
	CONSTRAINT ex_employee_weekly_period EXCLUDE USING gist (int4range(employee_id, employee_id, '[]') WITH &&, int4range(weekday, weekday, '[]') WITH &&, daterange(effective_from, effective_to, '[]') WITH &&), 
	FOREIGN KEY(employee_id) REFERENCES employees (id) ON DELETE RESTRICT, 
	FOREIGN KEY(template_id) REFERENCES employee_shift_templates (id) ON DELETE RESTRICT, 
	FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE RESTRICT
)
    """)
    op.execute("""
CREATE TABLE employee_shift_overrides (
	id SERIAL NOT NULL, 
	employee_id INTEGER NOT NULL, 
	shift_date DATE NOT NULL, 
	branch_id INTEGER NOT NULL, 
	is_rest BOOLEAN NOT NULL, 
	template_id INTEGER, 
	created_by INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_employee_shift_override UNIQUE (employee_id, shift_date), 
	CONSTRAINT ck_employee_shift_override_kind CHECK ((is_rest AND template_id IS NULL) OR (NOT is_rest AND template_id IS NOT NULL)), 
	FOREIGN KEY(employee_id) REFERENCES employees (id) ON DELETE RESTRICT, 
	FOREIGN KEY(branch_id) REFERENCES branches (id) ON DELETE RESTRICT, 
	FOREIGN KEY(template_id) REFERENCES employee_shift_templates (id) ON DELETE RESTRICT, 
	FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE RESTRICT
)
    """)
    op.execute("""
CREATE TABLE employee_shift_instances (
	id SERIAL NOT NULL, 
	employee_id INTEGER NOT NULL, 
	shift_date DATE NOT NULL, 
	branch_id INTEGER NOT NULL, 
	state VARCHAR(12) NOT NULL, 
	template_id INTEGER, 
	template_name VARCHAR(80), 
	source VARCHAR(12) NOT NULL, 
	start_at TIMESTAMP WITH TIME ZONE, 
	end_at TIMESTAMP WITH TIME ZONE, 
	grace_minutes INTEGER NOT NULL, 
	created_by INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_employee_shift_instance UNIQUE (employee_id, shift_date), 
	CONSTRAINT ck_employee_shift_state CHECK (state IN ('SCHEDULED','REST','UNASSIGNED')), 
	CONSTRAINT ck_employee_shift_source CHECK (source IN ('WEEKLY','OVERRIDE','NONE')), 
	CONSTRAINT ck_employee_instance_grace CHECK (grace_minutes BETWEEN 0 AND 120), 
	CONSTRAINT ck_employee_instance_times CHECK ((state='SCHEDULED' AND start_at IS NOT NULL AND end_at IS NOT NULL AND end_at > start_at AND template_id IS NOT NULL) OR (state<>'SCHEDULED' AND start_at IS NULL AND end_at IS NULL AND template_id IS NULL)), 
	CONSTRAINT ex_employee_instance_overlap EXCLUDE USING gist (int4range(employee_id, employee_id, '[]') WITH &&, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (state='SCHEDULED'), 
	FOREIGN KEY(employee_id) REFERENCES employees (id) ON DELETE RESTRICT, 
	FOREIGN KEY(branch_id) REFERENCES branches (id) ON DELETE RESTRICT, 
	FOREIGN KEY(template_id) REFERENCES employee_shift_templates (id) ON DELETE RESTRICT, 
	FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE RESTRICT
)
    """)
    op.create_index('ix_employee_weekly_shifts_employee_id','employee_weekly_shifts',['employee_id'])
    # Database-level immutability keeps snapshots and historical plans stable.
    op.execute("""CREATE FUNCTION omar_employee_shift_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Employee shift history is immutable' USING ERRCODE='23514'; END $$""")
    for table in ('employee_weekly_shifts','employee_shift_overrides','employee_shift_instances'):
        op.execute('CREATE TRIGGER immutable_employee_shift BEFORE UPDATE OR DELETE ON '+table+' FOR EACH ROW EXECUTE FUNCTION omar_employee_shift_immutable()')
    op.execute("""CREATE FUNCTION omar_employee_template_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (to_jsonb(NEW)-'is_active') IS DISTINCT FROM (to_jsonb(OLD)-'is_active') THEN
        RAISE EXCEPTION 'Create a new template instead of changing historical shift times' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$""")
    op.execute('CREATE TRIGGER immutable_employee_template BEFORE UPDATE ON employee_shift_templates FOR EACH ROW EXECUTE FUNCTION omar_employee_template_immutable()')


def downgrade():
    bind=op.get_bind()
    for table in ('employee_shift_instances','employee_shift_overrides','employee_weekly_shifts','employee_shift_templates'):
        if bind.execute(sa.text('SELECT EXISTS(SELECT 1 FROM '+table+')')).scalar():
            raise RuntimeError('Refusing to delete employee shift planning history.')
    for table in ('employee_shift_instances','employee_shift_overrides','employee_weekly_shifts','employee_shift_templates'):
        op.drop_table(table)
    op.execute('DROP FUNCTION omar_employee_shift_immutable()')
    op.execute('DROP FUNCTION omar_employee_template_immutable()')
