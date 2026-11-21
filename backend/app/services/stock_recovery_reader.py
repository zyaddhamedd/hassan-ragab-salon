"""Bounded page enrichment. SQL validates evidence prefixes, never reconstructs."""
from flask import current_app
from sqlalchemy import and_, cast, exists, func, literal, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import aliased

from app.extensions import db
from app.models.product import StockMovement
from app.models.stock_recovery import StockMovementRecovery as Recovery, StockRecoveryEvidence as Evidence, StockRecoveryRun as Run
from app.services.stock_recovery_contract import SOURCES, TIME_FIELDS, fingerprint, movement_fields, public_assumptions


def projection(table):
    """Whitelisted SQL counterpart of contract.project, including UTC microseconds."""
    args = []
    for field in SOURCES[table.name]:
        if field == 'notes_sha256':
            value = func.encode(func.sha256(func.convert_to(table.c.notes, 'UTF8')), 'hex')
        elif field in TIME_FIELDS:
            value = func.to_char(table.c[field].op('AT TIME ZONE')('UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        else:
            value = table.c[field]
        args.extend([field, value])
    return func.jsonb_build_object(*args)


def invalid_evidence_expression(recovery):
    checks = [~Evidence.source_table.in_(list(SOURCES))]
    for name in SOURCES:
        table = db.metadata.tables[name]
        mismatch = ~exists(select(literal(1)).select_from(table).where(table.c.id == Evidence.source_id,
                                projection(table) == cast(Evidence.expected, JSONB))).correlate(Evidence)
        checks.append(and_(Evidence.source_table == name, mismatch))
    invalid = exists(select(Evidence.id).where(
        Evidence.run_id == recovery.run_id, Evidence.evidence_group == recovery.evidence_group,
        Evidence.first_sequence <= recovery.sequence, or_(*checks))).correlate(recovery)
    missing_own = ~exists(select(Evidence.id).where(Evidence.run_id == recovery.run_id,
                          Evidence.evidence_group == recovery.evidence_group,
                          Evidence.source_table == 'stock_movements', Evidence.source_id == recovery.movement_id,
                          Evidence.first_sequence <= recovery.sequence)).correlate(recovery)
    return or_(invalid, missing_own)


def recovery_validation_query(ids):
    # New backdated insertions within a C prefix also invalidate it. No history
    # rows leave PostgreSQL; indexed prefix counts + evidence EXISTS are batched.
    m = aliased(StockMovement)
    prefix_count = select(func.count(m.id)).where(m.product_id == Recovery.product_id, m.branch_id == Recovery.branch_id,
                       m.created_at >= Recovery.anchor_at,
                       m.created_at <= select(StockMovement.created_at).where(StockMovement.id == Recovery.movement_id).correlate(Recovery).scalar_subquery()).correlate(Recovery).scalar_subquery()
    return (select(Recovery, Run.algorithm_version,
                   invalid_evidence_expression(Recovery).label('invalid_evidence'),
                   and_(Recovery.category == 'C', prefix_count != Recovery.sequence).label('invalid_prefix'))
            .join(Run, Run.id == Recovery.run_id).where(Recovery.movement_id.in_(ids), Run.active.is_(True)))


def unavailable(reason='NO_HISTORICAL_RESULT', delta=None, version=None, assumptions=None):
    return {'status': 'UNAVAILABLE', 'before': None, 'delta': delta, 'after': None, 'source': 'NONE',
            'algorithm_version': version, 'assumptions': assumptions or [], 'unavailable_reason': reason,
            'conditional_available': False}


def page_balances(movements, *, include_conditional=False):
    result, legacy = {}, []
    for m in movements:
        values = (m.balance_before, m.quantity_delta, m.balance_after)
        if all(v is not None for v in values) and values[0] + values[1] == values[2] and abs(values[1]) == m.quantity:
            result[m.id] = {'status': 'RECORDED', 'before': values[0], 'delta': values[1], 'after': values[2],
                            'source': 'OPERATION_SNAPSHOT', 'algorithm_version': None, 'assumptions': [],
                            'unavailable_reason': None, 'conditional_available': False}
        elif any(v is not None for v in values):
            result[m.id] = unavailable('INVALID_OPERATION_SNAPSHOT')  # Never substitute recovery.
        else:
            result[m.id] = unavailable()
            legacy.append(m)
    if not legacy or not current_app.config.get('INVENTORY_RECOVERY_ENABLED', False):
        return result
    by_id = {m.id: m for m in legacy}
    for recovery, version, invalid_evidence, invalid_prefix in db.session.execute(recovery_validation_query(list(by_id))):
        movement = by_id[recovery.movement_id]
        if (recovery.product_id != movement.product_id or recovery.branch_id != movement.branch_id
                or recovery.movement_fingerprint != fingerprint(movement_fields(movement))):
            result[movement.id] = unavailable('SOURCE_MOVEMENT_CHANGED')
            continue
        if invalid_evidence or invalid_prefix:
            result[movement.id] = unavailable('SOURCE_EVIDENCE_CHANGED')
            continue
        assumptions = public_assumptions(recovery.assumptions)
        if recovery.category == 'D':
            # Only reviewed reason codes cross the public API boundary.
            delta = recovery.quantity_delta
            raw_reason = recovery.unavailable_reason or ''
            reason = 'UNKNOWN_DIRECTION' if delta is None else 'UNKNOWN_STARTING_BALANCE'
            if raw_reason == 'ORIGINAL_ADJUSTMENT_SIGN_LOST':
                reason = 'UNKNOWN_ADJUSTMENT_SIGN'
            if 'DIRECTION_ASSUMED' in assumptions:
                # A writer convention is not an independently known D delta.
                delta, reason = None, 'DIRECTION_UNCONFIRMED'
            if 'ORDER' in raw_reason:
                reason = 'AMBIGUOUS_ORDER'
            elif any(word in raw_reason for word in ('REFERENCE', 'DUPLICATE')):
                reason = 'UNVERIFIED_SOURCE_REFERENCE'
            elif 'CONTRADICTED' in raw_reason or 'NEGATIVE' in raw_reason:
                reason = 'CONFLICTING_HISTORY'
            elif 'MISSING' in raw_reason:
                reason = 'INCOMPLETE_HISTORY'
            result[movement.id] = unavailable(reason, delta, version, assumptions)
            continue
        conditional = recovery.category == 'C'
        show = not conditional or include_conditional
        result[movement.id] = {
            'status': 'CONDITIONAL_RECONSTRUCTION' if conditional else 'VERIFIED_HISTORICAL',
            'before': recovery.balance_before if show else None, 'delta': recovery.quantity_delta if show else None,
            'after': recovery.balance_after if show else None,
            'source': 'CONDITIONAL_RECOVERY' if conditional else 'VERIFIED_RECOVERY',
            'algorithm_version': version, 'assumptions': assumptions,
            'unavailable_reason': 'CONDITIONAL_OPT_IN_REQUIRED' if conditional and not show else None,
            'conditional_available': conditional}
    return result
