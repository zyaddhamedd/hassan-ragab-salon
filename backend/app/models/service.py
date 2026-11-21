import enum
from datetime import datetime, timezone
from app.extensions import db

class CommissionType(enum.Enum):
    BARBER_ONLY = "BARBER_ONLY"
    BARBER_AND_ASSISTANT = "BARBER_AND_ASSISTANT"
    NO_COMMISSION = "NO_COMMISSION"

class ServiceCategory(db.Model):
    __tablename__ = 'service_categories'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    
    commission_type = db.Column(
        db.Enum(CommissionType, name='commission_type_enum'),
        default=CommissionType.BARBER_ONLY,
        nullable=False
    )
    
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    def __repr__(self):
        return f'<ServiceCategory {self.name}>'

class Service(db.Model):
    __tablename__ = 'services'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    
    price = db.Column(db.Float, default=0.0, nullable=False)
    barber_commission_percent = db.Column(db.Float, default=0.0, nullable=False)
    assistant_commission_percent = db.Column(db.Float, default=0.0, nullable=False)
    
    duration_minutes = db.Column(db.Integer, nullable=True)
    category_id = db.Column(db.Integer, db.ForeignKey('service_categories.id'), nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    category = db.relationship('ServiceCategory', backref=db.backref('services', lazy=True))

    def derive_commissions(self, total_commission: float):
        """
        Derives barber and assistant commission percentages based on category type.
        - BARBER_ONLY: 100% of input to barber, 0% to assistant.
        - BARBER_AND_ASSISTANT: 50% of input to barber, 50% to assistant.
        """
        if not self.category:
            self.barber_commission_percent = total_commission
            self.assistant_commission_percent = 0.0
            return

        from app.models.service import CommissionType # Local import to be safe

        if self.category.commission_type == CommissionType.BARBER_AND_ASSISTANT:
            self.barber_commission_percent = total_commission / 2.0
            self.assistant_commission_percent = total_commission / 2.0
        else:
            # Default to BARBER_ONLY behavior for other types
            self.barber_commission_percent = total_commission
            self.assistant_commission_percent = 0.0

    def __repr__(self):
        return f'<Service {self.name}>'

class BranchService(db.Model):
    __tablename__ = 'branch_services'

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    service_id = db.Column(db.Integer, db.ForeignKey('services.id'), nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        db.UniqueConstraint('branch_id', 'service_id', name='uq_branch_id_service_id'),
    )

    # Relationships
    branch = db.relationship('Branch', backref=db.backref('branch_services', lazy=True))
    service = db.relationship('Service', backref=db.backref('branch_services', lazy=True))

    def __repr__(self):
        return f'<BranchService {self.branch_id}-{self.service_id}>'
