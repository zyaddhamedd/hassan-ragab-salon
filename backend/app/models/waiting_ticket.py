from app.extensions import db
from datetime import datetime, date, timezone
from app.utils.date_utils import get_cairo_date

class WaitingTicket(db.Model):
    __tablename__ = 'waiting_tickets'

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False, default=1) # Default for migration, remove later if needed
    number = db.Column(db.Integer, nullable=False)
    date = db.Column(db.Date, nullable=False, default=lambda: get_cairo_date(), index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            'id': self.id,
            'number': self.number,
            'date': self.date.isoformat(),
            'created_at': self.created_at.isoformat()
        }
