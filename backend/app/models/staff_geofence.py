"""Immutable salon configuration versions. Never stores employee location samples."""
from datetime import datetime, timezone
from app.extensions import db


class StaffGeofenceVersion(db.Model):
    __tablename__='staff_geofence_versions'
    id=db.Column(db.Integer,primary_key=True)
    branch_id=db.Column(db.Integer,db.ForeignKey('branches.id',ondelete='RESTRICT'),nullable=False)
    version=db.Column(db.Integer,nullable=False)
    latitude=db.Column(db.Float,nullable=False)
    longitude=db.Column(db.Float,nullable=False)
    radius_m=db.Column(db.Float)
    max_accuracy_m=db.Column(db.Float)
    max_age_seconds=db.Column(db.Integer)
    enabled=db.Column(db.Boolean,nullable=False,default=False)
    actor_id=db.Column(db.Integer,db.ForeignKey('users.id',ondelete='RESTRICT'),nullable=False)
    reason=db.Column(db.String(200),nullable=False)
    created_at=db.Column(db.DateTime(timezone=True),nullable=False,default=lambda:datetime.now(timezone.utc))
    __table_args__=(
        db.UniqueConstraint('branch_id','version',name='uq_staff_geofence_branch_version'),
        db.CheckConstraint('version>0',name='ck_staff_geofence_version'),
        db.CheckConstraint('latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180',name='ck_staff_geofence_coordinates'),
        db.CheckConstraint("radius_m IS NULL OR (radius_m>0 AND radius_m<'Infinity')",name='ck_staff_geofence_radius'),
        db.CheckConstraint("max_accuracy_m IS NULL OR (max_accuracy_m>0 AND max_accuracy_m<'Infinity')",name='ck_staff_geofence_accuracy'),
        db.CheckConstraint('max_age_seconds IS NULL OR max_age_seconds BETWEEN 1 AND 300',name='ck_staff_geofence_age'),
        db.CheckConstraint('NOT enabled OR (radius_m IS NOT NULL AND max_accuracy_m IS NOT NULL AND max_age_seconds IS NOT NULL AND max_accuracy_m<=radius_m)',name='ck_staff_geofence_complete'),
    )
