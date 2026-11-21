"""Pure, shared fingerprint contract. No Flask/database initialization."""
from datetime import datetime, timezone
from hashlib import sha256
import json

FORMAT = 'nady-stock-recovery-v1'
TIME_FIELDS = {'created_at', 'paid_at', 'received_at', 'resolved_at', 'first_received_at'}
SOURCES = {
    'stock_movements': ('id', 'product_id', 'branch_id', 'movement_type', 'quantity', 'invoice_id', 'created_at', 'notes_sha256', 'balance_before', 'quantity_delta', 'balance_after'),
    'products': ('id', 'created_at'),
    'product_branch_stocks': ('id', 'product_id', 'branch_id', 'created_at'),
    'inventory_batches': ('id', 'product_id', 'batch_number', 'initial_quantity', 'source_type', 'source_ref', 'created_branch_id', 'created_at'),
    'branch_inventory_batches': ('id', 'batch_id', 'product_id', 'branch_id', 'first_received_at'),
    'stock_shipments': ('id', 'shipment_ref', 'shipment_type', 'source_branch_id', 'destination_branch_id', 'status', 'created_at', 'received_at'),
    'stock_shipment_items': ('id', 'shipment_id', 'product_id', 'quantity'),
    'stock_return_requests': ('id', 'return_ref', 'product_id', 'branch_id', 'requested_quantity', 'branch_stock_snapshot', 'status', 'created_at', 'resolved_at'),
    'invoices': ('id', 'branch_id', 'status', 'paid_at', 'created_at'),
    'invoice_items': ('id', 'invoice_id', 'product_id', 'item_type', 'quantity', 'created_at'),
}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def fingerprint(value):
    return sha256(canonical(value).encode('utf8')).hexdigest()


def utc(value):
    if value is None:
        return None
    dt = datetime.fromisoformat(value) if isinstance(value, str) else value
    if dt.tzinfo is None:
        raise ValueError('Timezone-aware source timestamps required')
    return dt.astimezone(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def project(table, row):
    if table not in SOURCES:
        raise ValueError('Unsupported recovery evidence source')
    result = {}
    for field in SOURCES[table]:
        if field == 'notes_sha256':
            value = row.get(field) if field in row else sha256(row['notes'].encode('utf8')).hexdigest() if row.get('notes') is not None else None
        elif field in {'balance_before', 'quantity_delta', 'balance_after'}:
            value = row.get(field)
        else:
            value = row[field]
        result[field] = utc(value) if field in TIME_FIELDS else getattr(value, 'value', value)
    return result


def movement_fields(movement):
    return project('stock_movements', {field: getattr(movement, field) for field in SOURCES['stock_movements'] if field != 'notes_sha256'} | {'notes': movement.notes})


def public_assumptions(flags):
    result = set()
    for flag in flags:
        if 'ORDER' in flag:
            result.add('ORDER_UNPROVEN')
        if 'RECORDED' in flag or 'LOST_UPDATES' in flag:
            result.add('HISTORICAL_COMPLETENESS_UNPROVEN')
        if 'WRITER_USED' in flag:
            result.add('DIRECTION_ASSUMED')
        if 'ZERO_' in flag:
            result.add('ZERO_INITIALIZATION_ASSUMED')
    return sorted(result)
