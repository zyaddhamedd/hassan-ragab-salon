"""Bounded Supply Center reads. No writes, history recovery or financial posting."""
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from math import ceil
import re

from flask import abort
from sqlalchemy import and_, or_, case, cast, String, func, literal, select, union_all
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models.branch import Branch
from app.models.product import Product, ProductBranchStock, StockMovement, StockMovementType
from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus
from app.models.supply_operations import StockShipment, StockShipmentItem, StockReturnRequest
from app.utils.admin_auth import resolve_branch_scope, GLOBAL_BRANCH_SCOPE_ROLES
from app.utils.date_utils import CAIRO_TZ, get_cairo_date


def integer(raw, name, default=None, maximum=None):
    if raw is None:
        if default is not None:
            return default
        raise ValueError(f'{name} is required.')
    if not str(raw).isdigit() or int(raw) < 1:
        raise ValueError(f'Invalid {name}.')
    value = int(raw)
    return min(value, maximum) if maximum else value


def scope(user, args):
    allowed = resolve_branch_scope(user, 'all')
    if not allowed:
        abort(403, description='No authorized inventory branches.')
    raw = str(args.get('branch_id') or 'all')
    selected = list(allowed)
    if raw.lower() != 'all':
        branch_id = integer(raw, 'branch_id')
        if branch_id not in allowed:
            abort(403, description='Access to this inventory branch is restricted.')
        selected = [branch_id]
    branches = Branch.query.filter(Branch.id.in_(allowed)).order_by(Branch.name, Branch.id).all()
    if len(selected) == 1 and not any(b.id == selected[0] for b in branches):
        abort(404, description='Inventory branch not found.')
    return allowed, selected, branches


def dates(args):
    today = get_cairo_date()
    try:
        for field in ['date_from', 'date_to']:
            if args.get(field) and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args[field]):
                raise ValueError()
        start = date.fromisoformat(args.get('date_from') or (today - timedelta(days=29)).isoformat())
        end = date.fromisoformat(args.get('date_to') or today.isoformat())
    except (TypeError, ValueError):
        raise ValueError('Dates must use YYYY-MM-DD.')
    if start > end or end == date.max or (end - start).days > 365:
        raise ValueError('Select an ordered date range of at most 366 days.')
    return start, end, window(start, end)


def window(start, end):
    return (datetime.combine(start, time.min, CAIRO_TZ).astimezone(timezone.utc),
            datetime.combine(end + timedelta(days=1), time.min, CAIRO_TZ).astimezone(timezone.utc))


def period(column, bounds):
    return and_(column >= bounds[0], column < bounds[1])


def money(value):
    return format(Decimal(str(value or 0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP), '.2f')


def pagination(page, per_page, total):
    pages = ceil(total / per_page)
    page = min(page, max(1, pages))
    return dict(page=page, per_page=per_page, total_items=total, total_pages=pages, has_prev=page > 1, has_next=page < pages)


def shipment_scope(ids):
    return or_(StockShipment.source_branch_id.in_(ids), StockShipment.destination_branch_id.in_(ids))


def _event_sources(ids, bounds):
    def shipment(kind, at, *conditions):
        return select(literal('shipment').label('source'), literal(kind).label('kind'), StockShipment.id.label('source_id'), at.label('event_at')).where(shipment_scope(ids), period(at, bounds), *conditions)
    def returns(kind, at, *conditions):
        return select(literal('return').label('source'), literal(kind).label('kind'), StockReturnRequest.id.label('source_id'), at.label('event_at')).where(StockReturnRequest.branch_id.in_(ids), period(at, bounds), *conditions)
    return union_all(
        shipment('DISPATCHED', StockShipment.created_at, StockShipment.shipment_type == 'OUTBOUND_TRANSFER'),
        shipment('CANCELLED', StockShipment.cancelled_at, StockShipment.shipment_type == 'OUTBOUND_TRANSFER', StockShipment.status == 'CANCELLED'),
        shipment('RECEIVED', StockShipment.received_at, StockShipment.shipment_type == 'OUTBOUND_TRANSFER', StockShipment.status == 'RECEIVED'),
        shipment('SUPPLY_RECEIVED', StockShipment.received_at, StockShipment.shipment_type == 'INBOUND_SUPPLY', StockShipment.status == 'RECEIVED'),
        returns('REQUESTED', StockReturnRequest.created_at),
        returns('RESOLVED', StockReturnRequest.resolved_at, StockReturnRequest.status.in_(['RETURNED_TO_MAIN', 'RETURNED_TO_SUPPLIER', 'REJECTED'])),
        select(literal('movement'), literal('STOCK_RECORD'), StockMovement.id, StockMovement.created_at).where(
            StockMovement.branch_id.in_(ids), period(StockMovement.created_at, bounds), StockMovement.movement_type != StockMovementType.PRODUCT_SALE),
    ).subquery()


def activity(ids, branches, bounds, limit):
    events = _event_sources(ids, bounds)
    counts = {kind: int(count) for kind, count in db.session.query(events.c.kind, func.count()).group_by(events.c.kind)}
    candidates = db.session.query(events).order_by(events.c.event_at.desc(), events.c.source.desc(), events.c.source_id.desc(), events.c.kind.desc()).limit(limit).all()
    ids_by_source = {source: [row.source_id for row in candidates if row.source == source] for source in ['shipment', 'return', 'movement']}
    shipments = {row.id: row for row in StockShipment.query.options(joinedload(StockShipment.items).joinedload(StockShipmentItem.product)).filter(StockShipment.id.in_(ids_by_source['shipment']))}
    returns = {row.id: row for row in StockReturnRequest.query.options(joinedload(StockReturnRequest.product)).filter(StockReturnRequest.id.in_(ids_by_source['return']))}
    movements = {row.id: row for row in StockMovement.query.options(joinedload(StockMovement.product)).filter(StockMovement.id.in_(ids_by_source['movement']))}
    names = {b.id: b.name for b in branches}
    rows = []
    for candidate in candidates:
        source, identity, kind = candidate.source, candidate.source_id, candidate.kind
        row = dict(activity_key=f'{source}-{identity}-{kind}', event_kind=kind, created_at=candidate.event_at.isoformat(), products=[], quantity=0, items_count=0, shipment_id=None, note=None, shipment_status=None, transfer_ref=None, shipment_ref=None)
        if source == 'shipment':
            document = shipments[identity]
            event_branch_id = document.source_branch_id if kind in {'DISPATCHED', 'CANCELLED'} else document.destination_branch_id
            branch_id = event_branch_id if event_branch_id in names else next(i for i in [document.source_branch_id, document.destination_branch_id] if i in ids)
            row.update(activity_type='SHIPMENT', branch_id=branch_id, branch_name=names.get(event_branch_id, 'موقع مرتبط بالمستند خارج نطاق العرض'), shipment_id=document.id if document.destination_branch_id in names else None,
                       shipment_status=document.status, shipment_ref=document.shipment_ref,
                       title={'CANCELLED':'إلغاء الشحنة وإعادة الكميات إلى مصدرها الأصلي', 'DISPATCHED':'إرسال شحنة من موقعها المصدر', 'RECEIVED':'استلام شحنة في وجهتها', 'SUPPLY_RECEIVED':'استلام مستند توريد في المخزن الرئيسي'}[kind])
            row['products'] = [dict(product_id=i.product_id, product_name=i.product.name if i.product else f'منتج #{i.product_id}', quantity=i.quantity, image_url=i.product.image_url if i.product else None) for i in document.items]
        elif source == 'return':
            document = returns[identity]
            row.update(activity_type='RETURN', branch_id=document.branch_id, branch_name=names.get(document.branch_id, 'موقع داخل النطاق'), return_ref=document.return_ref,
                       return_status='PENDING' if kind == 'REQUESTED' else document.status,
                       title='إنشاء طلب مرتجع' if kind == 'REQUESTED' else {'RETURNED_TO_MAIN':'تنفيذ مرتجع إلى المخزن الرئيسي', 'RETURNED_TO_SUPPLIER':'تنفيذ مرتجع إلى المورد', 'REJECTED':'رفض طلب المرتجع'}[document.status])
            row['products'] = [dict(product_id=document.product_id, product_name=document.product.name if document.product else f'منتج #{document.product_id}', quantity=document.requested_quantity, image_url=None)]
        else:
            movement = movements[identity]
            confirmed = (movement.balance_before is not None and movement.balance_after is not None and movement.quantity_delta is not None
                         and movement.balance_after == movement.balance_before + movement.quantity_delta and movement.quantity == abs(movement.quantity_delta))
            kind_label = {'INTERNAL_CONSUMPTION': 'استهلاك داخلي مؤكد' if confirmed and movement.quantity_delta < 0 else 'قيد استهلاك يحتاج تمييز الاتجاه' if not confirmed else 'تصحيح رصيد بنوع استهلاك',
                          'SUPPLY_IN':'قيد توريد مخزني', 'TRANSFER_OUT':'قيد خروج مخزني', 'TRANSFER_IN':'قيد دخول مخزني', 'RETURN_TO_SUPPLIER':'قيد مرتجع للمورد', 'STOCK_ADJUSTMENT':'تسوية مخزون'}.get(movement.movement_type.value, 'قيد حركة مخزنية')
            row.update(activity_type='INTERNAL_CONSUMPTION' if movement.movement_type == StockMovementType.INTERNAL_CONSUMPTION else 'STOCK_RECORD', branch_id=movement.branch_id, branch_name=names.get(movement.branch_id, 'موقع داخل النطاق'), title=kind_label,
                       record_basis='UNLINKED_STOCK_RECORD', movement_id=movement.id)
            row['products'] = [dict(product_id=movement.product_id, product_name=movement.product.name if movement.product else f'منتج #{movement.product_id}', quantity=movement.quantity, image_url=None)]
        row['items_count'] = len(row['products'])
        row['quantity'] = sum(p['quantity'] for p in row['products'])
        rows.append(row)
    return dict(items=rows, total_events=sum(counts.values()), limit=limit, has_more=sum(counts.values()) > len(rows),
                stock_records_notice='القيود المخزنية غير المرتبطة قد تقابل مستندات معروضة؛ لا تُجمع كعمليات مستقلة. الربط النصي أو تقارب الوقت لا يثبت التطابق.'), counts


def overview(user, args):
    allowed, selected, branches = scope(user, args)
    start, end, bounds = dates(args)
    main = [b for b in branches if b.is_main_warehouse and b.is_active]
    if len(main) > 1:
        raise ValueError('Multiple active main warehouses require configuration review.')
    main = main[0] if main else None
    stock = dict(warehouse_visible=main is not None, warehouse_name=main.name if main else None, warehouse_units=None, warehouse_value=None, known_cost_subtotal=None, missing_cost_products=0, zero_cost_products=0, negative_balance_rows=0)
    if main:
        qty = case((ProductBranchStock.stock_quantity > 0, ProductBranchStock.stock_quantity), else_=0)
        valid_cost = and_(Product.cost_price.isnot(None), Product.cost_price >= 0,
                          func.lower(cast(Product.cost_price, String)).notin_(['nan','infinity','-infinity','inf','-inf']))
        result = db.session.query(func.coalesce(func.sum(qty),0), func.coalesce(func.sum(case((valid_cost, qty * Product.cost_price), else_=0)),0),
            func.sum(case((and_(qty > 0, ~valid_cost),1),else_=0)), func.sum(case((and_(qty > 0, Product.cost_price == 0),1),else_=0)),
            func.sum(case((ProductBranchStock.stock_quantity < 0,1),else_=0))).join(Product, Product.id == ProductBranchStock.product_id).filter(ProductBranchStock.branch_id == main.id, Product.is_active.is_(True)).one()
        missing = int(result[2] or 0)
        stock.update(warehouse_units=int(result[0]), warehouse_value=None if missing else money(result[1]), known_cost_subtotal=money(result[1]), missing_cost_products=missing, zero_cost_products=int(result[3] or 0), negative_balance_rows=int(result[4] or 0))
    catalog = Product.query.filter(Product.is_active.is_(True))
    if user.role not in GLOBAL_BRANCH_SCOPE_ROLES:
        catalog = catalog.filter(Product.branch_stocks.any(ProductBranchStock.branch_id.in_(allowed)))
    stock['active_catalog_products'] = catalog.count()
    stock['active_operational_branches'] = sum(b.is_active and not b.is_main_warehouse for b in branches)
    stock['outstanding_shipments'] = StockShipment.query.filter(shipment_scope(selected), StockShipment.shipment_type == 'OUTBOUND_TRANSFER', StockShipment.status == 'IN_TRANSIT').count()
    stock['received_today'] = StockShipment.query.filter(shipment_scope(selected), StockShipment.shipment_type == 'OUTBOUND_TRANSFER', StockShipment.status == 'RECEIVED', period(StockShipment.received_at, window(get_cairo_date(), get_cairo_date()))).count()
    incoming = dict(db.session.query(StockShipment.destination_branch_id, func.count()).filter(StockShipment.destination_branch_id.in_(allowed), StockShipment.shipment_type == 'OUTBOUND_TRANSFER', StockShipment.status == 'IN_TRANSIT').group_by(StockShipment.destination_branch_id).all())
    received = dict(db.session.query(StockShipment.destination_branch_id, func.count()).filter(StockShipment.destination_branch_id.in_(allowed), StockShipment.shipment_type == 'OUTBOUND_TRANSFER', StockShipment.status == 'RECEIVED', period(StockShipment.received_at, window(get_cairo_date(), get_cairo_date()))).group_by(StockShipment.destination_branch_id).all())
    feed, counts = activity(selected, branches, bounds, integer(args.get('limit'), 'limit', 18, 50))
    return dict(meta=dict(as_of=datetime.now(timezone.utc).isoformat(), date_timezone='Africa/Cairo', date_from=start.isoformat(), date_to=end.isoformat(), branch_id=args.get('branch_id') or 'all', current_stock_basis='current_main_warehouse_current_cost', current_stock_independent_of_filters=True),
                current=stock, period=dict(dispatched_shipments=counts.get('DISPATCHED',0), received_shipments=counts.get('RECEIVED',0), supply_receipts=counts.get('SUPPLY_RECEIVED',0), resolved_return_events=counts.get('RESOLVED',0)),
                branches=[dict(id=b.id, name=b.name, is_active=b.is_active, is_main_warehouse=b.is_main_warehouse, outstanding_shipments=incoming.get(b.id,0), received_today=received.get(b.id,0)) for b in branches], activity=feed)


def _recorded_consumption():
    return and_(
        StockMovement.balance_before.isnot(None),
        StockMovement.balance_after.isnot(None),
        StockMovement.quantity_delta.isnot(None),
        StockMovement.balance_after == StockMovement.balance_before + StockMovement.quantity_delta,
        StockMovement.quantity == func.abs(StockMovement.quantity_delta),
    )


def _comparison_sources(ids, start, end, bounds, *, by_product=True, product_id=None):
    """Aggregate independent sources before merging; never join payments or stock.

    All-product branch summaries deliberately do not SUM quantities with different
    product units. A confirmed operation is one qualifying StockMovement row.
    """
    sales_group = [Invoice.branch_id]
    consumption_group = [StockMovement.branch_id]
    sales_fields = [Invoice.branch_id.label('branch_id'),
                    func.sum(InvoiceItem.service_price * InvoiceItem.quantity).label('gross')]
    recorded = _recorded_consumption()
    confirmed = and_(recorded, StockMovement.quantity_delta < 0)
    consumption_fields = [
        StockMovement.branch_id.label('branch_id'),
        func.sum(case((confirmed, 1), else_=0)).label('operations'),
        func.sum(case((~recorded, 1), else_=0)).label('unverified'),
        func.sum(case((and_(recorded, StockMovement.quantity_delta >= 0), 1), else_=0)).label('corrections'),
    ]
    if by_product:
        sales_group.insert(0, InvoiceItem.product_id)
        consumption_group.insert(0, StockMovement.product_id)
        sales_fields.insert(0, InvoiceItem.product_id.label('product_id'))
        consumption_fields.insert(0, StockMovement.product_id.label('product_id'))
    if by_product or product_id is not None:
        sales_fields.append(func.sum(InvoiceItem.quantity).label('units'))
        consumption_fields.append(func.sum(case((confirmed, -StockMovement.quantity_delta), else_=0)).label('confirmed'))
    sales = (db.session.query(*sales_fields).select_from(InvoiceItem)
             .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
             .join(Product, Product.id == InvoiceItem.product_id)
             .filter(Invoice.status == InvoiceStatus.PAID,
                     InvoiceItem.item_type == 'PRODUCT_ITEM', InvoiceItem.product_id.isnot(None),
                     Invoice.branch_id.in_(ids), Invoice.invoice_date >= start, Invoice.invoice_date <= end))
    consumption = db.session.query(*consumption_fields).filter(
        StockMovement.branch_id.in_(ids),
        StockMovement.movement_type == StockMovementType.INTERNAL_CONSUMPTION,
        period(StockMovement.created_at, bounds),
    )
    if product_id is not None:
        sales = sales.filter(InvoiceItem.product_id == product_id)
        consumption = consumption.filter(StockMovement.product_id == product_id)
    return sales.group_by(*sales_group).subquery(), consumption.group_by(*consumption_group).subquery()


def _comparison_product_scope(ids, start, end, bounds):
    # Match the approved selector scope: authorized stock records or matching
    # recorded sales/consumption in the selected period, including archived SKUs.
    sold = select(InvoiceItem.product_id).join(Invoice, Invoice.id == InvoiceItem.invoice_id).where(
        Invoice.status == InvoiceStatus.PAID, InvoiceItem.item_type == 'PRODUCT_ITEM',
        Invoice.branch_id.in_(ids), Invoice.invoice_date >= start, Invoice.invoice_date <= end,
    )
    consumed = select(StockMovement.product_id).where(
        StockMovement.branch_id.in_(ids), StockMovement.movement_type == StockMovementType.INTERNAL_CONSUMPTION,
        period(StockMovement.created_at, bounds),
    )
    return or_(Product.branch_stocks.any(ProductBranchStock.branch_id.in_(ids)),
               Product.id.in_(sold), Product.id.in_(consumed))


def _comparison_selector(args, ids, start, end, bounds):
    term = str(args.get('q') or '').strip()[:100]
    limit = integer(args.get('limit'), 'limit', 12, 20)
    if not term:
        return dict(items=[], limit=limit, has_more=False)
    products = (db.session.query(Product.id, Product.name, Product.unit)
                .filter(_comparison_product_scope(ids, start, end, bounds), Product.name.contains(term, autoescape=True))
                .order_by(Product.name, Product.id).limit(limit + 1).all())
    return dict(items=[dict(id=p.id, name=p.name, unit=p.unit) for p in products[:limit]],
                limit=limit, has_more=len(products) > limit)


def _branch_comparison(args, selected, branches, start, end, bounds):
    branch_rows = [branch for branch in branches if branch.id in selected and not branch.is_main_warehouse]
    ids = [branch.id for branch in branch_rows]
    product_id = integer(args.get('product_id'), 'product_id') if args.get('product_id') not in (None, '', 'all') else None
    product = None
    if product_id is not None:
        product = (db.session.query(Product.id, Product.name, Product.unit)
                   .filter(Product.id == product_id, _comparison_product_scope(ids, start, end, bounds)).first())
        if product is None:
            abort(404, description='Product is not available in the authorized comparison scope.')
    sales, consumption = _comparison_sources(ids, start, end, bounds, by_product=False, product_id=product_id)
    sales_by_branch = {row.branch_id: row for row in db.session.query(sales)}
    consumption_by_branch = {row.branch_id: row for row in db.session.query(consumption)}
    rows = []
    for branch in branch_rows:
        sale = sales_by_branch.get(branch.id)
        consumed = consumption_by_branch.get(branch.id)
        # Preserve historical coverage without presenting inactive zero-activity
        # branches as current operating locations. An explicitly selected one stays visible.
        if not branch.is_active and sale is None and consumed is None and len(selected) != 1:
            continue
        row = dict(
            branch_id=branch.id, branch_name=branch.name, branch_active=branch.is_active,
            gross_sales_value=money(sale.gross if sale else 0),
            confirmed_consumption_operations=int(consumed.operations or 0) if consumed else 0,
            historical_unverified_movement_count=int(consumed.unverified or 0) if consumed else 0,
            excluded_correction_count=int(consumed.corrections or 0) if consumed else 0,
        )
        if product_id is not None:
            row.update(units_sold=int(sale.units or 0) if sale else 0,
                       confirmed_consumption_units=int(consumed.confirmed or 0) if consumed else 0)
        rows.append(row)
    return dict(
        mode='selected_product' if product else 'all_products',
        product=dict(id=product.id, name=product.name, unit=product.unit) if product else None,
        rows=rows,
        meta=dict(date_from=start.isoformat(), date_to=end.isoformat(), date_timezone='Africa/Cairo',
                  branch_id=args.get('branch_id') or 'all', warehouse_excluded=True,
                  sales_basis='paid_product_items_invoice_date_gross_before_invoice_discount',
                  consumption_basis='negative_atomic_recorded_delta_only',
                  consumption_operation_basis='one_confirmed_stock_movement_row',
                  historical_values_estimated=False,
                  has_recorded_activity=bool(sales_by_branch or consumption_by_branch)),
    )


def comparison(user, args):
    _, selected, branches = scope(user, args)
    branch_rows = [b for b in branches if b.id in selected and not b.is_main_warehouse]
    ids = [b.id for b in branch_rows]
    start, end, bounds = dates(args)
    view = args.get('view')
    if view == 'branches':
        return _branch_comparison(args, selected, branches, start, end, bounds)
    if view == 'selector':
        return _comparison_selector(args, ids, start, end, bounds)
    if view not in (None, 'products'):
        raise ValueError('Invalid comparison view.')
    product_id = integer(args.get('product_id'), 'product_id') if args.get('product_id') not in (None,'','all') else None
    sort = args.get('sort') or 'product_name'
    if sort not in ['product_name','units_sold','confirmed_consumption']:
        raise ValueError('Invalid comparison sort.')
    per_page = integer(args.get('per_page'),'per_page',5,10)
    page = integer(args.get('page'),'page',1)
    sales, consumption = _comparison_sources(ids, start, end, bounds)
    activity_ids = union_all(select(sales.c.product_id),select(consumption.c.product_id)).subquery()
    term = str(args.get('q') or '').strip()[:100]
    products = Product.query
    if product_id:
        products = products.filter(Product.id == product_id, or_(Product.branch_stocks.any(ProductBranchStock.branch_id.in_(ids)),Product.id.in_(select(activity_ids.c.product_id))))
    elif term:
        # Bounded name search also lets the owner select an authorized stocked
        # product with no activity in this period, without fetching the catalog.
        products = products.filter(or_(Product.branch_stocks.any(ProductBranchStock.branch_id.in_(ids)),Product.id.in_(select(activity_ids.c.product_id))))
    else:
        products = products.filter(Product.id.in_(select(activity_ids.c.product_id)))
    if term:
        products = products.filter(Product.name.contains(term, autoescape=True))
    p = pagination(page,per_page,products.count())
    product_rows = products.order_by(Product.name,Product.id).offset((p['page']-1)*per_page).limit(per_page).all()
    visible_ids = [x.id for x in product_rows]
    sale_map = {(x.product_id,x.branch_id):x for x in db.session.query(sales).filter(sales.c.product_id.in_(visible_ids))}
    consumption_map = {(x.product_id,x.branch_id):x for x in db.session.query(consumption).filter(consumption.c.product_id.in_(visible_ids))}
    groups = []
    for product in product_rows:
        rows = []
        for branch in branch_rows:
            sale = sale_map.get((product.id,branch.id)); consumed = consumption_map.get((product.id,branch.id))
            if not branch.is_active and sale is None and consumed is None and len(selected) != 1:
                continue
            rows.append(dict(branch_id=branch.id,branch_name=branch.name,branch_active=branch.is_active,units_sold=int(sale.units or 0) if sale else 0,gross_sales_value=money(sale.gross if sale else 0),confirmed_consumption_units=int(consumed.confirmed or 0) if consumed else 0,historical_unverified_movement_count=int(consumed.unverified or 0) if consumed else 0,excluded_correction_count=int(consumed.corrections or 0) if consumed else 0))
        rows.sort(key=lambda x: (-(x['units_sold'] if sort == 'units_sold' else x['confirmed_consumption_units'] if sort == 'confirmed_consumption' else 0),x['branch_name'],x['branch_id']))
        totals={key:sum(row[key] for row in rows) for key in ['units_sold','confirmed_consumption_units','historical_unverified_movement_count','excluded_correction_count']}
        # Round once after summing stored gross values, not rounded branch cells.
        totals['gross_sales_value']=money(sum(Decimal(str(sale_map[(product.id,row['branch_id'])].gross or 0))
            for row in rows if (product.id,row['branch_id']) in sale_map))
        groups.append(dict(product_id=product.id,product_name=product.name,unit=product.unit,rows=rows,totals=totals))
    return dict(groups=groups,pagination=p,meta=dict(date_from=start.isoformat(),date_to=end.isoformat(),date_timezone='Africa/Cairo',sales_basis='paid_product_items_invoice_date_gross_before_invoice_discount',consumption_basis='negative_atomic_recorded_delta_only',historical_values_estimated=False,warehouse_excluded=True,product_id=product_id,branch_id=args.get('branch_id') or 'all',sort=sort))
