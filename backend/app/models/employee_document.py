from datetime import datetime, timezone
from app.extensions import db
import os

class EmployeeDocument(db.Model):
    __tablename__ = 'employee_documents'

    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=False)
    document_type = db.Column(db.String(50), nullable=False)  # 'بطاقة شخصية', 'فيش وتشبيه', ...
    file_path = db.Column(db.String(500), nullable=False)
    original_name = db.Column(db.String(255), nullable=True)
    uploaded_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # Use existing Employee model (backref defined here or in Employee if needed, but backref works)
    employee = db.relationship('Employee', backref=db.backref('documents', cascade='all, delete-orphan'))

    def to_dict(self):
        # Adjust path for frontend serving (supports Cloudinary, local uploads, or UPLOAD_BASE_URL)
        url = None
        if self.file_path:
            clean_path = self.file_path.replace(os.sep, '/')
            if clean_path.startswith(('http://', 'https://')):
                url = clean_path
            else:
                base = os.environ.get('UPLOAD_BASE_URL', '').strip().rstrip('/')
                relative = clean_path if clean_path.startswith('/uploads/') else f"/uploads/{clean_path.lstrip('/')}"
                url = f"{base}{relative}" if base else relative
        
        return {
            'id': self.id,
            'employee_id': self.employee_id,
            'type': self.document_type,
            'fileUrl': url,
            'uploadDate': self.uploaded_at.strftime('%Y-%m-%d'),
            'name': self.original_name or 'Document',
            'status': 'uploaded',
            'label': self.document_type
        }
