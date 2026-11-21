"""Controlled metadata-only preview/import; no HTTP registration or auto tasks."""
from collections import Counter, defaultdict
from bisect import bisect_right
from datetime import datetime
import re

from sqlalchemy import select

from app.extensions import db
from app.models.product import StockMovement
from app.models.stock_recovery import StockMovementRecovery as Recovery, StockRecoveryEvidence as Evidence, StockRecoveryRun as Run
from app.services.stock_recovery_contract import FORMAT, SOURCES, fingerprint, movement_fields, project, utc
from app.services.stock_recovery_reader import projection, recovery_validation_query


def validate_bundle(bundle):
    body = {k: v for k, v in bundle.items() if k != 'artifact_sha256'}
    if bundle.get('format') != FORMAT or fingerprint(body) != bundle.get('artifact_sha256'):
        raise ValueError('Recovery artifact checksum/format invalid')
    if len(bundle['items']) > 200000 or len(bundle['evidence']) > 1000000:
        raise ValueError('Recovery artifact exceeds review bounds')
    if not re.fullmatch(r'[0-9a-f]{64}', bundle['source_snapshot_fingerprint']):
        raise ValueError('Invalid source snapshot fingerprint')
    utc(bundle['generated_at'])
    if not re.fullmatch(r'[0-9A-Za-z._-]{1,32}', bundle['algorithm_version']):
        raise ValueError('Invalid algorithm version')
    ids, bindings = set(), {}
    evidence_keys = set()
    group_movements = defaultdict(list)
    for e in bundle['evidence']:
        if e['source_table'] not in SOURCES or set(e['expected']) != set(SOURCES[e['source_table']]):
            raise ValueError('Unreviewed evidence fields')
        if type(e['source_id']) is not int or e['expected']['id'] != e['source_id'] or type(e['first_sequence']) is not int or e['first_sequence'] < 1:
            raise ValueError('Invalid evidence identity or sequence')
        if project(e['source_table'], e['expected']) != e['expected']:
            raise ValueError('Noncanonical evidence')
        index = (e['evidence_group'], e['source_table'], e['source_id'])
        if index in evidence_keys:
            raise ValueError('Duplicate evidence candidate')
        evidence_keys.add(index)
        source = (e['source_table'], e['source_id'])
        if source in bindings and bindings[source] != e['expected']:
            raise ValueError('Conflicting original source evidence')
        bindings[source] = e['expected']
        if e['source_table'] == 'stock_movements':
            group_movements[e['evidence_group']].append(e)
    prefixes = {}
    for group, evidence_rows in group_movements.items():
        ordered = sorted(evidence_rows, key=lambda e: e['first_sequence'])
        prefixes[group] = ([e['first_sequence'] for e in ordered], ordered)
    for r in bundle['items']:
        if type(r['movement_id']) is not int or r['movement_id'] in ids:
            raise ValueError('Duplicate or invalid recovery candidate')
        ids.add(r['movement_id'])
        original = bindings.get(('stock_movements', r['movement_id']))
        if not original or fingerprint(original) != r['movement_fingerprint']:
            raise ValueError('Missing original movement binding')
        if (original['product_id'], original['branch_id']) != (r['product_id'], r['branch_id']):
            raise ValueError('Cross-location recovery candidate')
        if (r['evidence_group'], 'stock_movements', r['movement_id']) not in evidence_keys:
            raise ValueError('Missing own movement dependency')
        if r['category'] not in {'B', 'C', 'D'} or type(r['sequence']) is not int or r['sequence'] < 1:
            raise ValueError('Invalid recovery class or sequence')
        utc(r['anchor_at'])
        for field in ('segment_id', 'evidence_group'):
            if not re.fullmatch(r'[A-Za-z0-9_.-]{1,120}', r[field]):
                raise ValueError('Invalid recovery segment identity')
        if any(not re.fullmatch(r'[A-Z0-9_]{1,120}', flag) for flag in r['assumptions']):
            raise ValueError('Invalid assumption flag')
        before, delta, after = r['balance_before'], r['quantity_delta'], r['balance_after']
        if delta is not None and (type(delta) is not int or abs(delta) != original['quantity']):
            raise ValueError('Candidate delta differs from original quantity')
        if r['category'] == 'D':
            if before is not None or after is not None or not re.fullmatch(r'[A-Z0-9_]{1,120}', r['unavailable_reason'] or ''):
                raise ValueError('Unavailable recovery contains balances')
        elif type(before) is not int or type(after) is not int or delta is None or min(before, after) < 0 or before + delta != after:
            raise ValueError('Invalid candidate balance arithmetic')
        elif r['category'] == 'C' and 'TIMESTAMP_DISPLAY_ORDER_NOT_COMMIT_ORDER' not in r['assumptions']:
            raise ValueError('Conditional result lacks ordering disclosure')
        sequences, ordered = prefixes[r['evidence_group']]
        prefix = ordered[:bisect_right(sequences, r['sequence'])]
        if sorted(e['first_sequence'] for e in prefix) != list(range(1, r['sequence'] + 1)):
            raise ValueError('Incomplete movement dependency prefix')
        if any((e['expected']['product_id'], e['expected']['branch_id']) != (r['product_id'], r['branch_id']) for e in prefix):
            raise ValueError('Cross-location dependency prefix')
    return bindings


def destination_identity(session):
    from sqlalchemy import text
    identity = session.execute(text("SELECT current_database(), current_user, host(inet_server_addr()), inet_server_port(), oid::bigint FROM pg_database WHERE datname=current_database()")).one()
    return dict(zip(('database', 'user', 'host', 'port', 'oid'), identity))


def preview(session, bundle):
    bindings = validate_bundle(bundle)
    ids = [r['movement_id'] for r in bundle['items']]
    missing_sources, changed_sources = [], []
    for name in SOURCES:
        wanted = {identity: fields for (table, identity), fields in bindings.items() if table == name}
        if not wanted:
            continue
        table = db.metadata.tables[name]
        found = {}
        wanted_ids = list(wanted)
        for start in range(0, len(wanted_ids), 1000):
            found.update(session.execute(select(table.c.id, projection(table)).where(table.c.id.in_(wanted_ids[start:start + 1000]))).all())
        missing_sources.extend((name, identity) for identity in wanted if identity not in found)
        changed_sources.extend((name, identity) for identity in wanted if identity in found and found[identity] != wanted[identity])
    movements = {}
    for start in range(0, len(ids), 1000):
        movements.update({m.id: m for m in session.scalars(select(StockMovement).where(StockMovement.id.in_(ids[start:start + 1000])))})
    missing = sorted(set(ids) - set(movements))
    mismatched = [r['movement_id'] for r in bundle['items'] if r['movement_id'] in movements
                  and fingerprint(movement_fields(movements[r['movement_id']])) != r['movement_fingerprint']]
    existing = []
    for start in range(0, len(ids), 1000):
        existing.extend(session.scalars(select(Recovery.movement_id).where(Recovery.movement_id.in_(ids[start:start + 1000]))))
    result = {'artifact_sha256': bundle['artifact_sha256'], 'destination': destination_identity(session),
              'coverage': dict(sorted(Counter(r['category'] for r in bundle['items']).items())),
              'missing_movements': missing, 'mismatched_movements': mismatched,
              'missing_sources': sorted(missing_sources), 'changed_sources': sorted(changed_sources),
              'existing_candidates': sorted(existing),
              'recorded_priority_count': sum(m.balance_before is not None for m in movements.values()),
              'ready': not any((missing, mismatched, missing_sources, changed_sources, existing))}
    return {**result, 'approval_sha256': fingerprint(result)}


def import_approved(session, bundle, approval_sha256):
    """Caller MUST use SERIALIZABLE and commit/rollback the whole transaction.

    No UPDATE/DELETE or operational DML. Conflicts fail atomically; a changed
    preview needs a new human approval. Rows from another run are never replaced.
    """
    check = preview(session, bundle)
    if not check['ready'] or check['approval_sha256'] != approval_sha256:
        raise ValueError('Preview changed, conflicts exist, or explicit approval does not match')
    run_id = bundle['artifact_sha256']
    session.add(Run(id=run_id, algorithm_version=bundle['algorithm_version'], snapshot_identity=bundle['source_snapshot_identity'],
                    snapshot_fingerprint=bundle['source_snapshot_fingerprint'], generated_at=datetime.fromisoformat(utc(bundle['generated_at'])),
                    approved_preview=approval_sha256, active=True))
    session.flush()
    for e in bundle['evidence']:
        session.add(Evidence(run_id=run_id, **e))
    for item in bundle['items']:
        fields = dict(item)
        fields['anchor_at'] = datetime.fromisoformat(utc(fields['anchor_at']))
        session.add(Recovery(run_id=run_id, **fields))
    session.flush()
    # Reconcile using the SAME read-time checks before any commit.
    ids = [r['movement_id'] for r in bundle['items']]
    checked = 0
    for start in range(0, len(ids), 200):
        matches = session.execute(recovery_validation_query(ids[start:start + 200])).all()
        if any(bad or prefix for _, _, bad, prefix in matches):
            raise ValueError('Imported metadata failed source/prefix reconciliation')
        checked += len(matches)
    if checked != len(ids):
        raise ValueError('Imported candidate count mismatch')
    return {'run_id': run_id, 'imported': checked, 'operational_writes': 0}
