from datetime import datetime, timezone, date, time
import enum
from app.extensions import db

class AppointmentStatus(enum.Enum):
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class Appointment(db.Model):
    __tablename__ = 'appointments'

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), nullable=False)
    barber_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=True)  # Optional - can be assigned later
    service_id = db.Column(db.Integer, db.ForeignKey('services.id'), nullable=True)  # Optional - will be used when admin adds services
    service_name = db.Column(db.String(200), nullable=True)  # Free-text service name for now
    
    
    appointment_date = db.Column(db.Date, nullable=False, index=True)
    appointment_time = db.Column(db.Time, nullable=False)
    
    deposit_amount = db.Column(db.Integer, default=0, nullable=False)
    
    status = db.Column(
        db.Enum(AppointmentStatus, name='appointment_status_enum'),
        default=AppointmentStatus.SCHEDULED,
        nullable=False
    )
    
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    branch = db.relationship('Branch', backref=db.backref('appointments', lazy=True))
    customer = db.relationship('Customer', backref=db.backref('appointments', lazy=True))
    barber = db.relationship('Employee', backref=db.backref('appointments', lazy=True))
    service = db.relationship('Service', backref=db.backref('appointments', lazy=True))

    def __repr__(self):
        return f'<Appointment {self.id} - {self.customer_id} on {self.appointment_date}>'
