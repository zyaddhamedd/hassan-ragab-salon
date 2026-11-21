"""Server-side geofence evaluation only; no GPS collection or attendance writes."""
import math
from datetime import datetime, timezone
from sqlalchemy.exc import IntegrityError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound
from app.extensions import db
from app.models.branch import Branch
from app.models.staff_geofence import StaffGeofenceVersion as Version
from app.services.staff_identity_service import authorize, require_staff_identity_enabled

# Owner-supplied reference only. Never an implicitly enabled branch configuration.
OWNER_REFERENCE={
    'latitude':30.032083486995774,'longitude':30.987334731699523,
    'source':'https://maps.app.goo.gl/WEXisLjSK2jCRmVn7',
}
EARTH_RADIUS_M=6371008.8


def number(value,label):
    if isinstance(value,bool) or not isinstance(value,(int,float)):
        raise BadRequest('Expected numeric '+label+'.')
    try:result=float(value)
    except (OverflowError,ValueError):raise BadRequest('Invalid '+label+'.') from None
    if not math.isfinite(result):raise BadRequest('Invalid '+label+'.')
    return result


def coordinates(latitude,longitude):
    latitude,longitude=number(latitude,'latitude'),number(longitude,'longitude')
    if not -90<=latitude<=90 or not -180<=longitude<=180:
        raise BadRequest('Coordinates out of range.')
    return latitude,longitude


def current(branch_id):
    return Version.query.filter_by(branch_id=branch_id).order_by(Version.version.desc()).first()


def operating_branch(branch_id,lock=False):
    query=Branch.query.filter_by(id=branch_id)
    branch=(query.populate_existing().with_for_update() if lock else query).first()
    if not branch or not branch.is_active or branch.is_main_warehouse:
        raise NotFound('Operating branch not found.')
    return branch


def serialize(item):
    if item is None:return None
    return {key:getattr(item,key) for key in ('branch_id','version','latitude','longitude','radius_m','max_accuracy_m','max_age_seconds','enabled','actor_id','reason')}|{'created_at':item.created_at.isoformat()}


def read_configuration(actor,branch_id):
    authorize(actor);operating_branch(branch_id)
    return {'reference':dict(OWNER_REFERENCE),'configuration':serialize(current(branch_id)),
            'message':'Reference only; no radius or GPS accuracy is activated automatically.'}


def configure(actor,branch_id,data):
    authorize(actor)
    keys={'expected_version','latitude','longitude','radius_m','max_accuracy_m','max_age_seconds','enabled','reason'}
    if not isinstance(data,dict) or set(data)!=keys:raise BadRequest('Unexpected or missing geofence fields.')
    if type(data['expected_version']) is not int or data['expected_version']<0 or type(data['enabled']) is not bool:
        raise BadRequest('Invalid expected_version or enabled flag.')
    lat,lon=coordinates(data['latitude'],data['longitude'])
    thresholds={}
    for key in ('radius_m','max_accuracy_m'):
        value=data[key]
        thresholds[key]=None if value is None else number(value,key)
        if thresholds[key] is not None and thresholds[key]<=0:raise BadRequest('Thresholds must be positive.')
    age=data['max_age_seconds']
    if age is not None and (type(age) is not int or not 1<=age<=300):raise BadRequest('Choose a maximum age between 1 and 300 seconds.')
    if data['enabled'] and (any(v is None for v in thresholds.values()) or age is None or thresholds['max_accuracy_m']>thresholds['radius_m']):
        raise BadRequest('Explicit radius, accuracy and maximum age are required before enabling.')
    reason=data['reason']
    if not isinstance(reason,str) or not 3<=len(reason.strip())<=200:raise BadRequest('A 3–200 character configuration reason is required.')
    try:
        operating_branch(branch_id,lock=True)  # Serialize versions and stale checks per branch.
        previous=current(branch_id)
        version=previous.version if previous else 0
        if version!=data['expected_version']:raise Conflict('Stale geofence version. Reload the configuration.')
        item=Version(branch_id=branch_id,version=version+1,latitude=lat,longitude=lon,**thresholds,
            max_age_seconds=age,enabled=data['enabled'],actor_id=actor.id,reason=reason.strip())
        db.session.add(item);db.session.commit()
        return serialize(item)
    except IntegrityError:
        db.session.rollback();raise Conflict('Concurrent geofence configuration. Reload the latest version.') from None
    except Exception:
        db.session.rollback();raise


def distance_m(lat1,lon1,lat2,lon2):
    """Great-circle Haversine distance; inputs already validated as geographic degrees."""
    phi1,phi2=math.radians(lat1),math.radians(lat2)
    dphi,dlambda=phi2-phi1,math.radians(lon2-lon1)
    a=math.sin(dphi/2)**2+math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2*EARTH_RADIUS_M*math.atan2(math.sqrt(max(0,min(1,a))),math.sqrt(max(0,1-a)))


def evaluate(configuration,reading,*,now=None):
    """Pure validation. `now` is a trusted server/test clock, never a client input.

    Caller must supply the current branch version after Staff/device authorization.
    A reported accuracy disk must fit wholly inside the configured radius.
    """
    if not configuration or configuration.enabled is not True:
        raise Conflict('Geofence is not enabled or configured.')
    try:
        lat,lon=coordinates(configuration.latitude,configuration.longitude)
        radius=number(configuration.radius_m,'radius_m');maximum=number(configuration.max_accuracy_m,'max_accuracy_m')
        age_limit=configuration.max_age_seconds
        if radius<=0 or maximum<=0 or maximum>radius or type(age_limit) is not int or not 1<=age_limit<=300:
            raise BadRequest()
    except BadRequest:raise Conflict('Geofence configuration is incomplete or invalid.') from None
    if not isinstance(reading,dict) or set(reading)!={'latitude','longitude','accuracy_m','captured_at'}:
        raise BadRequest('Expected one location reading only.')
    sample_lat,sample_lon=coordinates(reading['latitude'],reading['longitude'])
    accuracy=number(reading['accuracy_m'],'accuracy_m')
    if accuracy<=0:raise BadRequest('Invalid location accuracy.')
    raw=reading['captured_at']
    if not isinstance(raw,str) or len(raw)>64:raise BadRequest('Expected a timezone-aware capture timestamp.')
    try:
        captured=datetime.fromisoformat(raw.replace('Z','+00:00'))
        if captured.tzinfo is None or captured.utcoffset() is None:raise ValueError()
        captured_utc=captured.astimezone(timezone.utc)
    except (ValueError,OverflowError):raise BadRequest('Expected a timezone-aware capture timestamp.') from None
    now=now or datetime.now(timezone.utc)
    if now.tzinfo is None:raise ValueError('Server clock must be timezone-aware.')
    age=(now-captured_utc).total_seconds()
    if age<0 or age>age_limit:raise Forbidden('Location reading is stale or future-dated.')
    if accuracy>maximum:raise Forbidden('Location reading is too inaccurate.')
    distance=distance_m(lat,lon,sample_lat,sample_lon)
    if distance+accuracy>radius:raise Forbidden('Location uncertainty extends outside the configured geofence.')
    return {'geofence_version':configuration.version,'distance_m':round(distance,3),'evaluated_at':now.astimezone(timezone.utc).isoformat()}


def validate_employee_location(user,reading):
    """Future protected attendance integration only; not a public evaluation endpoint."""
    require_staff_identity_enabled()
    from app.services.staff_auth_service import _active
    if not _active(user):raise Forbidden('Staff employee is not eligible.')
    # No client-selected employee/branch/config/version. Always use the latest version.
    operating_branch(user.employee.branch_id,lock=True)
    return evaluate(current(user.employee.branch_id),reading)
