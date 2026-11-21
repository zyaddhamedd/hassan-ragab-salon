"""Separate, explicitly imported recovery metadata; never operational stock."""
from datetime import datetime, timezone
from app.extensions import db


class StockRecoveryRun(db.Model):
    __tablename__ = 'stock_recovery_runs'
    id = db.Column(db.String(64), primary_key=True)  # Approved artifact SHA256.
    algorithm_version = db.Column(db.String(32), nullable=False)
    snapshot_identity = db.Column(db.JSON, nullable=False)
    snapshot_fingerprint = db.Column(db.String(64), nullable=False)
    generated_at = db.Column(db.DateTime(timezone=True), nullable=False)
    imported_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    approved_preview = db.Column(db.String(64), nullable=False)
    active = db.Column(db.Boolean, nullable=False, default=True)


class StockMovementRecovery(db.Model):
    __tablename__ = 'stock_movement_recoveries'
    # Deliberately no FK into operational tables: metadata cannot restrict their
    # lifecycle. Exact identity/evidence checks are mandatory on import and read.
    movement_id = db.Column(db.Integer, primary_key=True)
    run_id = db.Column(db.String(64), db.ForeignKey('stock_recovery_runs.id'), nullable=False, index=True)
    product_id = db.Column(db.Integer, nullable=False)
    branch_id = db.Column(db.Integer, nullable=False)
    movement_fingerprint = db.Column(db.String(64), nullable=False)
    category = db.Column(db.String(1), nullable=False)
    balance_before = db.Column(db.Integer)
    quantity_delta = db.Column(db.Integer)
    balance_after = db.Column(db.Integer)
    segment_id = db.Column(db.String(120), nullable=False)
    evidence_group = db.Column(db.String(120), nullable=False)
    sequence = db.Column(db.Integer, nullable=False)
    anchor_at = db.Column(db.DateTime(timezone=True), nullable=False)
    assumptions = db.Column(db.JSON, nullable=False)
    unavailable_reason = db.Column(db.String(120))
    __table_args__ = (
        db.CheckConstraint("category IN ('B','C','D')", name='ck_recovery_category'),
        db.CheckConstraint("sequence > 0", name='ck_recovery_sequence'),
        db.CheckConstraint("(category = 'D' AND balance_before IS NULL AND balance_after IS NULL AND unavailable_reason IS NOT NULL) OR "
                           "(category IN ('B','C') AND balance_before IS NOT NULL AND quantity_delta IS NOT NULL AND balance_after IS NOT NULL "
                           "AND balance_before >= 0 AND balance_after >= 0 AND balance_after = balance_before + quantity_delta)", name='ck_recovery_balance'),
    )


class StockRecoveryEvidence(db.Model):
    __tablename__ = 'stock_recovery_evidence'
    id = db.Column(db.Integer, primary_key=True)
    run_id = db.Column(db.String(64), db.ForeignKey('stock_recovery_runs.id'), nullable=False)
    evidence_group = db.Column(db.String(120), nullable=False)
    first_sequence = db.Column(db.Integer, nullable=False)
    source_table = db.Column(db.String(60), nullable=False)
    source_id = db.Column(db.Integer, nullable=False)
    expected = db.Column(db.JSON, nullable=False)  # Whitelisted nonpersonal source fields only.
    __table_args__ = (
        db.UniqueConstraint('run_id', 'evidence_group', 'source_table', 'source_id', name='uq_recovery_evidence_source'),
        db.Index('ix_recovery_evidence_prefix', 'run_id', 'evidence_group', 'first_sequence', 'source_table'),
    )
