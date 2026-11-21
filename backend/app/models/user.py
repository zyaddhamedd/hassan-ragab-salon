from datetime import datetime, timezone
import enum
from sqlalchemy import FetchedValue
from flask_sqlalchemy.query import Query
from app.extensions import db

class UserRole(enum.Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    EXEC_ADMIN = "EXEC_ADMIN"
    BRANCH_MANAGER = "BRANCH_MANAGER"
    STORE_MANAGER = "STORE_MANAGER"
    ADMIN = "ADMIN"  # Legacy - kept for backward compatibility
    CASHIER = "CASHIER"
    EMPLOYEE = "EMPLOYEE"

class _UserQuery(Query):
    def count(self):
        # SQLAlchemy's entity count otherwise expands even deferred new columns.
        # Preserve projected/distinct queries; only project the full User entity.
        descriptions = self.column_descriptions
        if len(descriptions) == 1 and descriptions[0].get('expr') is User:
            return Query.count(self.with_entities(User.id))
        return Query.count(self)


class User(db.Model):
    query_class = _UserQuery
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(256), nullable=False)
    
    # Use named enum for PostgreSQL
    role = db.Column(db.Enum(UserRole, name='user_role_enum'), nullable=False)
    
    # Foreign key to branches table (note plural table name)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=True)
    
    # Additive Staff identity metadata; never infer this link from names/email.
    # Deferred fields keep legacy SELECTs compatible before the optional migration.
    # Fetched defaults omit these fields from legacy INSERTs; no eager RETURNING.
    employee_id = db.deferred(db.Column(db.Integer, db.ForeignKey('employees.id', ondelete='RESTRICT', name='fk_user_staff_employee'),
                                       nullable=True, server_default=FetchedValue()))
    staff_auth_version = db.deferred(db.Column(db.Integer, nullable=False, server_default='1'))
    staff_password_initialized = db.deferred(db.Column(db.Boolean, nullable=False, server_default=db.false()))
    __mapper_args__ = {'eager_defaults': False}
    employee = db.relationship('Employee', foreign_keys='User.employee_id',
                               backref=db.backref('staff_user', uselist=False, passive_deletes='all'))
    __table_args__ = (
        db.UniqueConstraint('employee_id', name='uq_user_staff_employee'),
        db.CheckConstraint("employee_id IS NULL OR role = 'EMPLOYEE'", name='ck_user_staff_role'),
        db.CheckConstraint('staff_auth_version >= 1', name='ck_user_staff_auth_version'),
    )

    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    branch = db.relationship('Branch', backref=db.backref('users', lazy=True))

    def set_password(self, password):
        """Hash and set the user's password"""
        from werkzeug.security import generate_password_hash
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        """Verify the user's password"""
        from werkzeug.security import check_password_hash
        return check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f'<User {self.email}>'
