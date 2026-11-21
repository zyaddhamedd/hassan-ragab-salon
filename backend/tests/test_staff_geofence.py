"""Offline geofence boundaries and Omar manager authorization. No GPS or live DB."""
from pathlib import Path
import sys,math,importlib.util
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace
from io import StringIO
from unittest import TestCase
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import test_staff_identity as identity
from app.extensions import db
from app.models.staff_geofence import StaffGeofenceVersion as Version
from app.models.user import User,UserRole
from app.models.branch import Branch
from app.services import staff_geofence_service as geo
from app.api.admin_staff_geofence import admin_staff_geofence_bp
from werkzeug.exceptions import BadRequest,Conflict,Forbidden,NotFound
from sqlalchemy.exc import IntegrityError
from alembic.operations import Operations
from alembic.migration import MigrationContext


class GeofenceTests(TestCase):
    token=identity.StaffIdentityTests.token
    def setUp(self):
        identity.StaffIdentityTests.setUp(self)
        db.metadata.create_all(db.engine,tables=[Version.__table__]);self.app.register_blueprint(admin_staff_geofence_bp)
        self.now=datetime(2026,10,29,12,tzinfo=timezone.utc)

    def configuration(self,**changes):
        return SimpleNamespace(version=1,enabled=True,**{'latitude':geo.OWNER_REFERENCE['latitude'],'longitude':geo.OWNER_REFERENCE['longitude'],'radius_m':150.,'max_accuracy_m':20.,'max_age_seconds':30,**changes})

    def reading(self,**changes):
        return {'latitude':geo.OWNER_REFERENCE['latitude'],'longitude':geo.OWNER_REFERENCE['longitude'],'accuracy_m':5.,'captured_at':self.now.isoformat(),**changes}

    def payload(self,**changes):
        return {'expected_version':0,'latitude':geo.OWNER_REFERENCE['latitude'],'longitude':geo.OWNER_REFERENCE['longitude'],
            'radius_m':None,'max_accuracy_m':None,'max_age_seconds':None,'enabled':False,'reason':'Offline configuration fixture',**changes}

    def test_owner_reference_is_exact_and_never_implicitly_enabled(self):
        self.assertEqual(geo.OWNER_REFERENCE['latitude'],30.032083486995774)
        self.assertEqual(geo.OWNER_REFERENCE['longitude'],30.987334731699523)
        result=geo.read_configuration(self.manager,self.branch.id)
        self.assertIsNone(result['configuration']);self.assertEqual(Version.query.count(),0)
        with self.assertRaises(Conflict):geo.evaluate(None,self.reading(),now=self.now)
        row=geo.configure(self.manager,self.branch.id,self.payload())
        self.assertFalse(row['enabled']);self.assertIsNone(row['radius_m'])
        with self.assertRaises(Conflict):geo.evaluate(geo.current(self.branch.id),self.reading(),now=self.now)

    def test_incomplete_configuration_never_activates(self):
        for data in [self.payload(enabled=True),self.payload(enabled=True,radius_m=100,max_accuracy_m=120,max_age_seconds=30)]:
            with self.assertRaises(BadRequest):geo.configure(self.manager,self.branch.id,data)
        for field in ['radius_m','max_accuracy_m','max_age_seconds']:
            config=self.configuration();setattr(config,field,None)
            with self.assertRaises(Conflict):geo.evaluate(config,self.reading(),now=self.now)
        self.assertEqual(Version.query.count(),0)

    def test_server_distance_and_accuracy_disk_boundary(self):
        config=self.configuration();reading=self.reading()
        self.assertEqual(geo.evaluate(config,reading,now=self.now)['distance_m'],0)
        # Exact equatorial angular distance; no rounded result is used for acceptance.
        config.latitude=0.;config.longitude=0.;reading.update(latitude=math.degrees(145/geo.EARTH_RADIUS_M),longitude=0.)
        self.assertAlmostEqual(geo.distance_m(0,0,reading['latitude'],0),145,places=8)
        self.assertAlmostEqual(geo.evaluate(config,reading,now=self.now)['distance_m'],145,places=3)
        reading['latitude']=math.degrees(145.001/geo.EARTH_RADIUS_M)
        with self.assertRaises(Forbidden):geo.evaluate(config,reading,now=self.now)
        reading['latitude']=math.degrees(149/geo.EARTH_RADIUS_M)
        with self.assertRaises(Forbidden):geo.evaluate(config,reading,now=self.now)  # Center inside, uncertainty outside.

    def test_freshness_boundaries_future_and_naive_timestamp(self):
        for seconds in [0,30]:geo.evaluate(self.configuration(),self.reading(captured_at=(self.now-timedelta(seconds=seconds)).isoformat()),now=self.now)
        for seconds in [30.001,-.001]:
            with self.assertRaises(Forbidden):geo.evaluate(self.configuration(),self.reading(captured_at=(self.now-timedelta(seconds=seconds)).isoformat()),now=self.now)
        for timestamp in ['2026-10-29T12:00:00','not-a-time','0001-01-01T00:00:00+14:00',None]:
            with self.assertRaises(BadRequest):geo.evaluate(self.configuration(),self.reading(captured_at=timestamp),now=self.now)
        geo.evaluate(self.configuration(),self.reading(captured_at='2026-10-29T14:00:00+02:00'),now=self.now)

    def test_invalid_inaccurate_and_forged_fields_rejected(self):
        for field in ['latitude','longitude','accuracy_m']:
            for value in [True,float('nan'),float('inf'),'30',None]:
                with self.assertRaises(BadRequest):geo.evaluate(self.configuration(),self.reading(**{field:value}),now=self.now)
        for changes in [dict(latitude=91),dict(longitude=-181),dict(accuracy_m=0),dict(accuracy_m=-1)]:
            with self.assertRaises(BadRequest):geo.evaluate(self.configuration(),self.reading(**changes),now=self.now)
        with self.assertRaises(Forbidden):geo.evaluate(self.configuration(),self.reading(accuracy_m=20.001),now=self.now)
        with self.assertRaises(BadRequest):geo.evaluate(self.configuration(),self.reading(employee_id=99),now=self.now)

    def test_antimeridian_poles_and_antipodal_distance(self):
        self.assertLess(geo.distance_m(0,180,0,-180),.000001)
        self.assertLess(geo.distance_m(90,-180,90,180),.000001)
        self.assertAlmostEqual(geo.distance_m(0,0,0,180),math.pi*geo.EARTH_RADIUS_M,places=5)

    def test_versions_stale_write_and_disable_never_falls_back(self):
        one=geo.configure(self.manager,self.branch.id,self.payload(enabled=True,radius_m=150,max_accuracy_m=20,max_age_seconds=30))
        with self.assertRaises(Conflict):geo.configure(self.manager,self.branch.id,self.payload())
        two=geo.configure(self.manager,self.branch.id,self.payload(expected_version=1))
        self.assertEqual((one['version'],two['version']),(1,2));self.assertEqual(Version.query.count(),2)
        self.assertTrue(db.session.get(Version,1).enabled)
        with self.assertRaises(Conflict):geo.evaluate(geo.current(self.branch.id),self.reading(),now=self.now)

    def test_role_api_isolation_warehouse_and_feature_disabled(self):
        path=f'/api/admin/branches/{self.branch.id}/staff-geofence'
        for marker in ['staff','mini']:
            self.assertEqual(self.client.get(path,headers={'Authorization':'Bearer '+self.token(marker)}).status_code,403)
        for role in [UserRole.BRANCH_MANAGER,UserRole.STORE_MANAGER,UserRole.CASHIER]:
            self.manager.role=role;db.session.commit()
            response=self.client.post(path,headers={'Authorization':'Bearer '+self.token()},json=self.payload());self.assertEqual(response.status_code,403)
        self.manager.role=UserRole.EXEC_ADMIN;db.session.commit()
        response=self.client.post(path,headers={'Authorization':'Bearer '+self.token()},json=self.payload());self.assertEqual(response.status_code,201)
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        warehouse=Branch(name='Offline warehouse',city='Giza',is_main_warehouse=True);db.session.add(warehouse);db.session.commit()
        with self.assertRaises(NotFound):geo.read_configuration(self.manager,warehouse.id)
        self.app.config['STAFF_IDENTITY_ENABLED']=False
        self.assertEqual(self.client.get(path).status_code,404)

    def test_employee_service_uses_own_latest_branch_and_no_location_storage(self):
        staff_id=self.create_staff()
        staff=db.session.get(User,staff_id)
        geo.configure(self.manager,self.branch.id,self.payload())
        with self.assertRaises(Conflict):geo.validate_employee_location(staff,self.reading())
        staff.is_active=False
        with self.assertRaises(Forbidden):geo.validate_employee_location(staff,self.reading())
        self.assertNotIn('captured_at',Version.__table__.columns)
        self.assertNotIn('accuracy_m',Version.__table__.columns)

    def create_staff(self):
        from app.services.staff_identity_service import change_identity
        result=change_identity(self.manager,self.employee.id,'create',{'username':'offline_geofence_staff'})
        change_identity(self.manager,self.employee.id,'state',{'is_active':True,'expected_version':1})
        return result['user_id']

    def test_unique_branch_version_and_additive_postgres_migration(self):
        geo.configure(self.manager,self.branch.id,self.payload())
        row=Version(branch_id=self.branch.id,version=1,latitude=0,longitude=0,enabled=False,actor_id=self.manager.id,reason='Duplicate fixture')
        db.session.add(row)
        with self.assertRaises(IntegrityError):db.session.flush()
        db.session.rollback()
        path=Path(__file__).resolve().parents[1]/'migrations/versions/zx_staff_geofence_versions.py'
        spec=importlib.util.spec_from_file_location('geofence_revision',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        output=StringIO()
        with Operations.context(MigrationContext.configure(url='postgresql://',opts={'as_sql':True,'output_buffer':output})):module.upgrade()
        sql=output.getvalue();self.assertIn('immutable_staff_geofence',sql);self.assertIn('DEFAULT false',sql)
        self.assertNotIn('INSERT INTO',sql);self.assertNotIn('attendance',sql.lower())
