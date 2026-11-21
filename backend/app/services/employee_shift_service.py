"""Versioned future scheduling and explicit immutable planning snapshots."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import or_, and_
from sqlalchemy.exc import IntegrityError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound
from app.extensions import db
from app.models.employee import Employee
from app.models.branch import Branch
from app.models.user import UserRole
from app.models.employee_shift import EmployeeShiftTemplate as Template, EmployeeWeeklyShift as Weekly, EmployeeShiftOverride as Override, EmployeeShiftInstance as Instance, EmployeeShiftChange as Change
from app.services.staff_identity_service import require_staff_identity_enabled

CAIRO = ZoneInfo('Africa/Cairo')
ROLES = (UserRole.SUPER_ADMIN, UserRole.EXEC_ADMIN, UserRole.BRANCH_MANAGER)


def today():
    return datetime.now(CAIRO).date()


def authorize(actor, branch_id):
    require_staff_identity_enabled()
    if not actor or not actor.is_active or actor.role not in ROLES:
        raise Forbidden('Scheduling requires an authorized manager.')
    if actor.role == UserRole.BRANCH_MANAGER and actor.branch_id != branch_id:
        raise Forbidden('Scheduling is restricted to the assigned branch.')
    branch = db.session.get(Branch, branch_id)
    if not branch or not branch.is_active or branch.is_main_warehouse:
        raise NotFound('Operating branch not found.')


def employee(actor, employee_id, lock=False):
    q = Employee.query.filter_by(id=employee_id)
    item = (q.populate_existing().with_for_update() if lock else q).first()
    if not item or item.is_deleted:
        raise NotFound('Employee not found.')
    authorize(actor, item.branch_id)
    return item


def fields(data, expected):
    if not isinstance(data, dict) or set(data) != set(expected):
        raise BadRequest('Unexpected or missing fields.')


def day(value):
    if not isinstance(value, str):
        raise BadRequest('Expected ISO date.')
    try:
        result = date.fromisoformat(value)
        if result.isoformat() != value or result in (date.min,date.max):
            raise ValueError()
        return result
    except ValueError:
        raise BadRequest('Expected YYYY-MM-DD.') from None


def period(start, end, maximum=366):
    start, end = day(start), day(end)
    if not 0 <= (end-start).days < maximum:
        raise BadRequest('Date range exceeds the supported planning window.')
    return start, end


def days(start, end):
    for offset in range((end-start).days+1):
        yield start+timedelta(days=offset)


def clock(value):
    if not isinstance(value, str):
        raise BadRequest('Expected HH:MM.')
    try:
        result = time.fromisoformat(value)
        if result.strftime('%H:%M') != value or result.tzinfo:
            raise ValueError()
        return result
    except ValueError:
        raise BadRequest('Expected HH:MM.') from None


def template_data(item):
    return dict(id=item.id, branch_id=item.branch_id, name=item.name, start_time=item.start_time.strftime('%H:%M'),
                end_time=item.end_time.strftime('%H:%M'), grace_minutes=item.grace_minutes, is_active=item.is_active)


def create_template(actor, data):
    fields(data, ('branch_id','name','start_time','end_time','grace_minutes'))
    if type(data['branch_id']) is not int:
        raise BadRequest('Expected branch ID.')
    authorize(actor, data['branch_id'])
    if not isinstance(data['name'], str) or not 1 <= len(data['name'].strip()) <= 80:
        raise BadRequest('Expected a short template name.')
    start, end = clock(data['start_time']), clock(data['end_time'])
    if start == end or type(data['grace_minutes']) is not int or not 0 <= data['grace_minutes'] <= 120:
        raise BadRequest('Invalid duration or grace minutes.')
    item = Template(branch_id=data['branch_id'], name=data['name'].strip(), start_time=start, end_time=end,
                    grace_minutes=data['grace_minutes'], is_active=True, created_by=actor.id)
    db.session.add(item); db.session.commit()
    return template_data(item)


def active_template(template_id, branch_id):
    if type(template_id) is not int:
        raise BadRequest('Expected template ID.')
    item = db.session.get(Template, template_id)
    if not item or not item.is_active or item.branch_id != branch_id:
        raise Conflict('An active template from the employee branch is required.')
    return item


def utc_local(day_value, clock_value):
    naive = datetime.combine(day_value, clock_value)
    local = naive.replace(tzinfo=CAIRO, fold=0)  # Earliest occurrence for an ambiguous autumn clock.
    utc = local.astimezone(timezone.utc)
    if utc.astimezone(CAIRO).replace(tzinfo=None) != naive:
        raise Conflict('Shift falls in a nonexistent Cairo DST time; choose an explicit valid override.')
    return utc


def expectation(item, shift_date):
    frozen = Instance.query.filter_by(employee_id=item.id, shift_date=shift_date).first()
    if frozen:
        return frozen
    override = Override.query.filter_by(employee_id=item.id, shift_date=shift_date, retired_from=None).first()
    weekly = None if override else Weekly.query.filter(Weekly.employee_id==item.id, Weekly.weekday==shift_date.weekday(),
        Weekly.effective_from<=shift_date, Weekly.effective_to>=shift_date, or_(Weekly.retired_from.is_(None), Weekly.retired_from>shift_date)).first()
    selected = override or weekly
    template = db.session.get(Template, selected.template_id) if selected and selected.template_id else None
    state = 'SCHEDULED' if template else ('REST' if override else 'UNASSIGNED')
    start = utc_local(shift_date, template.start_time) if template else None
    end = utc_local(shift_date+timedelta(days=template.end_time < template.start_time), template.end_time) if template else None
    return Instance(employee_id=item.id, shift_date=shift_date, branch_id=template.branch_id if template else (override.branch_id if override else item.branch_id),
        state=state, template_id=template.id if template else None, template_name=template.name if template else None,
        source='OVERRIDE' if override else ('WEEKLY' if weekly else 'NONE'), start_at=start, end_at=end,
        grace_minutes=template.grace_minutes if template else 0)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def check_overlap(item, start, end):
    # Include both boundaries: previous overnight shifts and next-day assignments.
    previous = None
    for current_day in days(start-timedelta(days=1), end+timedelta(days=1)):
        current = expectation(item, current_day)
        if current.state != 'SCHEDULED':
            continue
        if previous is not None and aware(previous.end_at) > aware(current.start_at):
            raise Conflict('Employee shift intervals overlap, including an overnight boundary.')
        previous = current


def plan(actor, employee_id, kind, data):
    expected = ('template_id','weekday','effective_from','effective_to') if kind=='weekly' else ('shift_date','is_rest','template_id')
    fields(data, expected)
    try:
        item = employee(actor, employee_id, lock=True)  # Serializes ALL scheduling writes per employee.
        if kind == 'weekly':
            start, end = period(data['effective_from'], data['effective_to'])
            if type(data['weekday']) is not int or not 0 <= data['weekday'] <= 6:
                raise BadRequest('weekday must be Monday=0 through Sunday=6.')
            active_template(data['template_id'], item.branch_id)
            if Weekly.query.filter(Weekly.employee_id==item.id, Weekly.weekday==data['weekday'], Weekly.effective_from<=end, Weekly.effective_to>=start, or_(Weekly.retired_from.is_(None), and_(Weekly.retired_from>start, Weekly.retired_from>Weekly.effective_from))).first():
                raise Conflict('Overlapping effective periods for this weekday.')
            affected = [d for d in days(start,end) if d.weekday()==data['weekday']]
            if not affected:
                raise BadRequest('No matching weekday in the supplied period.')
            row = Weekly(employee_id=item.id, created_by=actor.id, **{k:(start if k=='effective_from' else end if k=='effective_to' else v) for k,v in data.items()})
        else:
            start = end = day(data['shift_date']); affected = [start]
            if type(data['is_rest']) is not bool or (data['is_rest'] and data['template_id'] is not None):
                raise BadRequest('Rest override requires is_rest=true and template_id=null.')
            if not data['is_rest']:
                active_template(data['template_id'], item.branch_id)
            if Override.query.filter_by(employee_id=item.id, shift_date=start, retired_from=None).first():
                raise Conflict('An override already exists for this day.')
            row = Override(employee_id=item.id, branch_id=item.branch_id, shift_date=start, is_rest=data['is_rest'], template_id=data['template_id'], created_by=actor.id)
        if start <= today():
            raise Conflict('Planning changes must start after the current Cairo day.')
        if Instance.query.filter(Instance.employee_id==item.id, Instance.shift_date.in_(affected)).first():
            raise Conflict('A shift expectation is already frozen for an affected day.')
        db.session.add(row); db.session.flush()
        check_overlap(item, start, end)
        db.session.commit()
        return {'id':row.id,'version':row.version}
    except IntegrityError:
        db.session.rollback()
        raise Conflict('Concurrent or overlapping scheduling request.') from None
    except Exception:
        db.session.rollback()
        raise


def serialize(item):
    return {'shift_date':item.shift_date.isoformat(), 'branch_id':item.branch_id, 'state':item.state, 'source':item.source,
        'template_name':item.template_name, 'start_at':aware(item.start_at).isoformat() if item.start_at else None,
        'end_at':aware(item.end_at).isoformat() if item.end_at else None, 'timezone':'Africa/Cairo',
        'grace_minutes':item.grace_minutes, 'frozen':item.id is not None}


def read_shifts(item, start, end):
    # Read-only planning projection. No implicit snapshot creation or attendance writes.
    return [serialize(expectation(item,d)) for d in days(start,end)]


def freeze(actor, employee_id, start, end):
    try:
        item = employee(actor,employee_id,lock=True)
        check_overlap(item,start,end)
        rows=[]
        for d in days(start,end):
            row=expectation(item,d)
            if actor.role==UserRole.BRANCH_MANAGER and row.branch_id!=actor.branch_id:
                raise Forbidden('Historical shift belongs to another branch.')
            if row.id is None:
                row.created_by=actor.id;db.session.add(row)
            rows.append(row)
        db.session.flush(); result=[serialize(row) for row in rows];db.session.commit()
        return result
    except IntegrityError:
        db.session.rollback();raise Conflict('Concurrent or overlapping shift snapshot.') from None
    except Exception:
        db.session.rollback();raise


def edit_plan(actor, employee_id, kind, row_id, data):
    model=Weekly if kind=='weekly' else Override
    try:
        item=employee(actor,employee_id,lock=True)
        row=model.query.filter_by(id=row_id,employee_id=item.id).populate_existing().with_for_update().first()
        if not row:raise NotFound('Assignment not found.')
        if not isinstance(data,dict) or data.get('operation') not in ('replace','cancel'):
            raise BadRequest('Expected explicit replace or cancel operation.')
        replacing=data['operation']=='replace'
        required={'operation','expected_version','reason'}
        if kind=='weekly':required.add('effective_from')
        if replacing:required.update({'template_id'} if kind=='weekly' else {'template_id','is_rest'})
        fields(data,required)
        if type(data['expected_version']) is not int or row.version!=data['expected_version'] or row.retired_from is not None:
            raise Conflict('Stale assignment version. Reload the current plan.')
        reason=data['reason']
        if not isinstance(reason,str) or not 3<=len(reason.strip())<=200:raise BadRequest('A 3–200 character reason is required.')
        start=day(data['effective_from']) if kind=='weekly' else row.shift_date
        end=row.effective_to if kind=='weekly' else start
        if start<=today() or (kind=='weekly' and not row.effective_from<=start<=end):
            raise Conflict('Only a future suffix of this assignment can be changed.')
        dates=[d for d in days(start,end) if kind!='weekly' or d.weekday()==row.weekday]
        if not dates:raise BadRequest('No affected shift dates.')
        if Instance.query.filter(Instance.employee_id==item.id,Instance.shift_date.in_(dates)).first():
            raise Conflict('An affected expectation is already frozen.')
        # Original branch must also be in scope after any employee transfer.
        old_branch=db.session.get(Template,row.template_id).branch_id if kind=='weekly' else row.branch_id
        authorize(actor,old_branch)
        new=None
        if replacing:
            if kind=='weekly':
                active_template(data['template_id'],item.branch_id)
                new=Weekly(employee_id=item.id,template_id=data['template_id'],weekday=row.weekday,effective_from=start,effective_to=end,created_by=actor.id,supersedes_id=row.id)
            else:
                if type(data['is_rest']) is not bool or (data['is_rest'] and data['template_id'] is not None):raise BadRequest('Invalid rest override.')
                if not data['is_rest']:active_template(data['template_id'],item.branch_id)
                new=Override(employee_id=item.id,branch_id=item.branch_id,shift_date=start,is_rest=data['is_rest'],template_id=data['template_id'],created_by=actor.id,supersedes_id=row.id)
        # This is explicit lifecycle metadata only; original dates/times/identity remain unchanged.
        row.retired_from=start;row.retired_by=actor.id;row.retired_at=datetime.now(timezone.utc);row.version+=1
        db.session.flush()  # Release active range/unique key before inserting the successor.
        if new:db.session.add(new)
        change=Change(employee_id=item.id,weekly_id=row.id if kind=='weekly' else None,override_id=row.id if kind!='weekly' else None,
            action='REPLACE' if replacing else 'CANCEL',effective_from=start,actor_id=actor.id,reason=reason.strip())
        db.session.add(change);db.session.flush();check_overlap(item,start,end);db.session.commit()
        return {'id':new.id if new else row.id,'version':new.version if new else row.version,'superseded_id':row.id,'operation':data['operation']}
    except IntegrityError:
        db.session.rollback();raise Conflict('Concurrent, stale or overlapping shift change.') from None
    except Exception:
        db.session.rollback();raise
