"""Explicit future supersession; original shift rows and frozen expectations survive."""
from alembic import op
import sqlalchemy as sa
revision='zw_employee_shift_supersession'
down_revision='zv_employee_shift_planning'
branch_labels=None
depends_on=None


def upgrade():
    for table in ('employee_weekly_shifts','employee_shift_overrides'):
        op.add_column(table,sa.Column('version',sa.Integer(),nullable=False,server_default='1'))
        op.add_column(table,sa.Column('retired_from',sa.Date()))
        op.add_column(table,sa.Column('retired_by',sa.Integer(),sa.ForeignKey('users.id',ondelete='RESTRICT')))
        op.add_column(table,sa.Column('retired_at',sa.DateTime(timezone=True)))
        op.add_column(table,sa.Column('supersedes_id',sa.Integer(),sa.ForeignKey(table+'.id',ondelete='RESTRICT')))
        op.create_unique_constraint('uq_'+table+'_supersedes',table,['supersedes_id'])
        op.create_check_constraint('ck_'+table+'_lifecycle',table,"(version=1 AND retired_from IS NULL AND retired_by IS NULL AND retired_at IS NULL) OR (version=2 AND retired_from IS NOT NULL AND retired_by IS NOT NULL AND retired_at IS NOT NULL)")
        op.execute('DROP TRIGGER immutable_employee_shift ON '+table)
    op.drop_constraint('ex_employee_weekly_period','employee_weekly_shifts')
    op.execute("ALTER TABLE employee_weekly_shifts ADD CONSTRAINT ex_employee_weekly_period EXCLUDE USING gist (int4range(employee_id,employee_id,'[]') WITH &&,int4range(weekday,weekday,'[]') WITH &&,daterange(effective_from,least(effective_to+1,retired_from),'[)') WITH &&)")
    op.drop_constraint('uq_employee_shift_override','employee_shift_overrides')
    op.create_index('uq_employee_shift_override','employee_shift_overrides',['employee_id','shift_date'],unique=True,postgresql_where=sa.text('retired_from IS NULL'))
    op.create_table('employee_shift_changes',
        sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('employee_id',sa.Integer(),sa.ForeignKey('employees.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('weekly_id',sa.Integer(),sa.ForeignKey('employee_weekly_shifts.id',ondelete='RESTRICT'),unique=True),
        sa.Column('override_id',sa.Integer(),sa.ForeignKey('employee_shift_overrides.id',ondelete='RESTRICT'),unique=True),
        sa.Column('action',sa.String(8),nullable=False),sa.Column('effective_from',sa.Date(),nullable=False),
        sa.Column('actor_id',sa.Integer(),sa.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('reason',sa.String(200),nullable=False),sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
        sa.CheckConstraint('(weekly_id IS NOT NULL AND override_id IS NULL) OR (weekly_id IS NULL AND override_id IS NOT NULL)',name='ck_employee_change_target'),
        sa.CheckConstraint("action IN ('REPLACE','CANCEL')",name='ck_employee_change_action'))
    op.execute('CREATE TRIGGER immutable_employee_shift BEFORE UPDATE OR DELETE ON employee_shift_changes FOR EACH ROW EXECUTE FUNCTION omar_employee_shift_immutable()')
    op.execute("""CREATE FUNCTION omar_employee_shift_retire() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE cutoff date; last_day date; has_frozen boolean;
    BEGIN
      PERFORM 1 FROM employees WHERE id=OLD.employee_id FOR UPDATE;
      cutoff:=NEW.retired_from;
      IF OLD.retired_from IS NOT NULL OR OLD.version<>1 OR NEW.version<>2 OR cutoff IS NULL OR
         cutoff <= (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date OR
         NEW.retired_by IS NULL OR NEW.retired_at IS NULL OR
         (to_jsonb(NEW)-ARRAY['version','retired_from','retired_by','retired_at']) IS DISTINCT FROM
         (to_jsonb(OLD)-ARRAY['version','retired_from','retired_by','retired_at']) THEN
        RAISE EXCEPTION 'Invalid or stale future supersession' USING ERRCODE='23514';
      END IF;
      IF TG_TABLE_NAME='employee_weekly_shifts' THEN
        last_day:=OLD.effective_to;
        IF cutoff<OLD.effective_from OR cutoff>last_day THEN
          RAISE EXCEPTION 'Invalid future suffix' USING ERRCODE='23514';
        END IF;
        SELECT EXISTS(SELECT 1 FROM employee_shift_instances WHERE employee_id=OLD.employee_id
          AND shift_date BETWEEN cutoff AND last_day AND (extract(isodow FROM shift_date)::int-1)=OLD.weekday) INTO has_frozen;
      ELSE
        IF cutoff<>OLD.shift_date THEN RAISE EXCEPTION 'Override date cannot move' USING ERRCODE='23514'; END IF;
        SELECT EXISTS(SELECT 1 FROM employee_shift_instances WHERE employee_id=OLD.employee_id AND shift_date=OLD.shift_date) INTO has_frozen;
      END IF;
      IF has_frozen THEN RAISE EXCEPTION 'Frozen expectation cannot change' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$""")
    op.execute("""CREATE FUNCTION omar_employee_shift_change_required() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE change employee_shift_changes; successor_count int;
    BEGIN
      IF TG_TABLE_NAME='employee_weekly_shifts' THEN
        SELECT * INTO change FROM employee_shift_changes WHERE weekly_id=NEW.id;
        SELECT count(*) INTO successor_count FROM employee_weekly_shifts WHERE supersedes_id=NEW.id AND employee_id=NEW.employee_id AND weekday=NEW.weekday AND effective_from=NEW.retired_from AND effective_to=NEW.effective_to;
      ELSE
        SELECT * INTO change FROM employee_shift_changes WHERE override_id=NEW.id;
        SELECT count(*) INTO successor_count FROM employee_shift_overrides WHERE supersedes_id=NEW.id AND employee_id=NEW.employee_id AND shift_date=NEW.shift_date;
      END IF;
      IF change.id IS NULL OR change.employee_id<>NEW.employee_id OR change.actor_id<>NEW.retired_by OR
         change.effective_from<>NEW.retired_from OR length(trim(change.reason)) NOT BETWEEN 3 AND 200 OR
         (change.action='REPLACE' AND successor_count<>1) OR (change.action='CANCEL' AND successor_count<>0) THEN
        RAISE EXCEPTION 'Explicit matching supersession audit required' USING ERRCODE='23514';
      END IF;
      RETURN NULL;
    END $$""")
    for table in ('employee_weekly_shifts','employee_shift_overrides'):
        op.execute('CREATE TRIGGER retire_employee_shift BEFORE UPDATE ON '+table+' FOR EACH ROW EXECUTE FUNCTION omar_employee_shift_retire()')
        op.execute('CREATE TRIGGER immutable_employee_shift BEFORE DELETE ON '+table+' FOR EACH ROW EXECUTE FUNCTION omar_employee_shift_immutable()')
        op.execute('CREATE CONSTRAINT TRIGGER audit_employee_shift AFTER UPDATE ON '+table+' DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION omar_employee_shift_change_required()')


def downgrade():
    if op.get_bind().execute(sa.text('SELECT EXISTS(SELECT 1 FROM employee_shift_changes) OR EXISTS(SELECT 1 FROM employee_weekly_shifts WHERE retired_from IS NOT NULL) OR EXISTS(SELECT 1 FROM employee_shift_overrides WHERE retired_from IS NOT NULL)')).scalar():
        raise RuntimeError('Refusing to remove supersession history.')
    for table in ('employee_weekly_shifts','employee_shift_overrides'):
        op.execute('DROP TRIGGER retire_employee_shift ON '+table)
        op.execute('DROP TRIGGER audit_employee_shift ON '+table)
        op.execute('DROP TRIGGER immutable_employee_shift ON '+table)
    op.drop_table('employee_shift_changes')
    op.execute('DROP FUNCTION omar_employee_shift_change_required()')
    op.execute('DROP FUNCTION omar_employee_shift_retire()')
    op.drop_constraint('ex_employee_weekly_period','employee_weekly_shifts')
    op.execute("ALTER TABLE employee_weekly_shifts ADD CONSTRAINT ex_employee_weekly_period EXCLUDE USING gist (int4range(employee_id,employee_id,'[]') WITH &&,int4range(weekday,weekday,'[]') WITH &&,daterange(effective_from,effective_to,'[]') WITH &&)")
    op.drop_index('uq_employee_shift_override',table_name='employee_shift_overrides')
    op.create_unique_constraint('uq_employee_shift_override','employee_shift_overrides',['employee_id','shift_date'])
    for table in ('employee_weekly_shifts','employee_shift_overrides'):
        op.drop_constraint('ck_'+table+'_lifecycle',table)
        for column in ('supersedes_id','retired_at','retired_by','retired_from','version'):op.drop_column(table,column)
        op.execute('CREATE TRIGGER immutable_employee_shift BEFORE UPDATE OR DELETE ON '+table+' FOR EACH ROW EXECUTE FUNCTION omar_employee_shift_immutable()')
