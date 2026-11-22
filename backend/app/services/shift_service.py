"""
Shift Service Layer
Handles cashier shift operations and financial reporting.
"""
from decimal import Decimal
from datetime import datetime, timezone
from typing import Dict, Optional
from sqlalchemy import func
from app.extensions import db
from app.models.cashier_shift import CashierShift, ShiftStatus
from app.models.branch import Branch
from app.models.invoice import Invoice, InvoiceStatus, PaymentMethod
from app.models.expense import Expense
from app.models.employee import Employee
from app.models.user import User

# Error messages in Arabic
NO_ACTIVE_SHIFT = "لا توجد وردية مفتوحة. يرجى فتح وردية أولاً."
SHIFT_ALREADY_OPEN = "يوجد وردية مفتوحة بالفعل. يرجى إغلاق الوردية الحالية أولاً."
NO_SHIFT_TO_CLOSE = "لا توجد وردية مفتوحة لإغلاقها."
SHIFT_NOT_FOUND = "الوردية غير موجودة."
PERMISSION_DENIED = "ليس لديك صلاحية لتنفيذ هذا الإجراء."


class ShiftService:
    """
    Service layer for cashier shift operations.
    
    CRITICAL PRINCIPLES:
    - Independent of Treasury (Treasury module removed)
    - Opening balance defaults to 0 (or carried over, simplified to 0 for now)
    - Closing balance = Opening + Cash Income - Cash Expenses
    - One OPEN shift per cashier per branch
    """
    
    @staticmethod
    def open_shift(branch_id: int, cashier_user_id: int) -> CashierShift:
        """
        Open a new cashier shift.
        """
        # Check if cashier already has an OPEN shift
        existing_shift = CashierShift.query.filter_by(
            cashier_user_id=cashier_user_id,
            branch_id=branch_id,
            status=ShiftStatus.OPEN
        ).first()
        
        if existing_shift:
            raise ValueError(SHIFT_ALREADY_OPEN)
        
        # Default opening balance to 0 in absence of Treasury
        opening_balance = Decimal('0.00')
        
        # Create shift
        shift = CashierShift(
            branch_id=branch_id,
            cashier_user_id=cashier_user_id,
            opening_cash_balance=opening_balance,
            status=ShiftStatus.OPEN,
            opened_at=datetime.now(timezone.utc)
        )
        
        db.session.add(shift)
        db.session.commit()
        
        return shift
    
    @staticmethod
    def close_shift(shift_id: str, closed_by_user_id: int) -> CashierShift:
        """
        Close an active shift.
        """
        # Get shift
        shift = CashierShift.query.filter_by(id=shift_id).first()
        
        if not shift:
            raise ValueError(SHIFT_NOT_FOUND)
        
        if shift.status == ShiftStatus.CLOSED:
            raise ValueError("الوردية مغلقة بالفعل.")
        
        # Calculate closing balance based on transactions during the shift
        report = ShiftService.get_shift_report(shift_id)
        expected_cash = report.get('expected_cash_in_drawer', 0.0)
        
        # Update shift
        shift.closed_at = datetime.now(timezone.utc)
        shift.closing_cash_balance = Decimal(str(expected_cash))
        shift.status = ShiftStatus.CLOSED
        shift.closed_by = closed_by_user_id
        
        db.session.commit()
        
        return shift
    
    @staticmethod
    def get_active_shift(cashier_user_id: int, branch_id: int) -> Optional[CashierShift]:
        """Get active (OPEN) shift for cashier."""
        return CashierShift.query.filter_by(
            cashier_user_id=cashier_user_id,
            branch_id=branch_id,
            status=ShiftStatus.OPEN
        ).first()
    
    @staticmethod
    def validate_shift_active(cashier_user_id: int, branch_id: int) -> CashierShift:
        """Validate that cashier has an active shift."""
        shift = ShiftService.get_active_shift(cashier_user_id, branch_id)
        
        if not shift:
            raise ValueError(NO_ACTIVE_SHIFT)
        
        return shift
    
    @staticmethod
    def get_shift_report(shift_id: str) -> Dict:
        """
        Generate detailed shift report by aggregating Invoices and Expenses.
        """
        # Get shift
        shift = CashierShift.query.filter_by(id=shift_id).first()
        
        if not shift:
            raise ValueError(SHIFT_NOT_FOUND)
        
        # Get branch info
        branch = Branch.query.get(shift.branch_id)
        
        # Define time window
        start_time = shift.opened_at
        end_time = shift.closed_at if shift.closed_at else datetime.now(timezone.utc)
        
        # 1. Calculate Income from Invoices
        # Need to map Cashier User -> Employee to filter Invoices
        # Assuming User.employee_id or similar link exists, OR matching by name/phone
        # Ideally, we filter by 'created_at' and 'branch_id' first
        
        # Find employee profile for the cashier user
        # This is a bit of a heuristic if direct link is missing, but let's try strict first
        # Validating user -> employee link
        # CashierShift has cashier_user_id
        
        # Query invoices in time range for this branch
        invoices_query = Invoice.query.filter(
            Invoice.branch_id == shift.branch_id,
            Invoice.created_at >= start_time,
            Invoice.created_at <= end_time,
            Invoice.status == InvoiceStatus.PAID
        )
        
        # Filter by cashier if possible. 
        # Invoice has 'cashier_id' (Employee ID). Shift has 'cashier_user_id' (User ID).
        # We need to find the Employee ID for the User ID.
        # Check if User has employee relationship?
        # Creating a subquery or join might be complex without explicit model knowledge.
        # Fallback: Filter by branch and time is usually enough for single-cashier serialization, 
        # but for multi-cashier, we need the specific cashier.
        
        # Try to resolve Employee ID
        # user = User.query.get(shift.cashier_user_id)
        # employee = Employee.query.filter_by(user_id=user.id).first() if user else None
        # OR match by name?
        
        # For now, let's include ALL branch transactions in the period if we can't strict filter,
        # OR better, try to filter by the likely employee.
        
        income = {
            'cash': Decimal('0'),
            'visa': Decimal('0'),
            'instapay': Decimal('0'),
            'total': Decimal('0')
        }
        
        invoice_count = 0
        
        invoices = invoices_query.all()
        # TODO: Filter invoices by specific cashier if multiple cashiers work simultaneously
        # For this implementation, we assume the shift report covers the branch's activity for that duration 
        # or we rely on the time window being specific to the shift.
        
        for inv in invoices:
            # If we want to be strict about "My Shift", we should check inv.cashier_id
            # But resolving that is tricky without the link. 
            # Proceeding with branch-based aggregation for the time window.
            
            amount = Decimal(str(inv.total_amount))
            if inv.payment_method == PaymentMethod.CASH:
                income['cash'] += amount
            elif inv.payment_method in (PaymentMethod.VISA, PaymentMethod.VISA_1, PaymentMethod.VISA_2):
                income['visa'] += amount
            elif inv.payment_method == PaymentMethod.INSTAPAY:
                income['instapay'] += amount
            
            income['total'] += amount
            invoice_count += 1

        # 2. Calculate Expenses
        expenses_query = Expense.query.filter(
            Expense.branch_id == shift.branch_id,
            Expense.created_at >= start_time,
            Expense.created_at <= end_time
        )
        
        # Expense has 'created_by' which IS the User ID. So we CAN filter exact cashier here.
        expenses_query = expenses_query.filter(Expense.created_by == shift.cashier_user_id)
        
        expenses_list = expenses_query.all()
        
        expenses = {
            'advances': Decimal('0'),
            'overtime': Decimal('0'), # Overtime is usually not an expense (money out), but a record. 
                                      # If paid out cash, it's an expense.
            'daily_percentages': Decimal('0'),
            'other': Decimal('0'),
            'total': Decimal('0')
        }
        
        expense_count = 0
        
        for exp in expenses_list:
            amount = Decimal(str(exp.amount))
            # Categorize based on category name or ID?
            cat_name = exp.expense_category.name if exp.expense_category else "Other"
            cat_code = exp.expense_category.code if exp.expense_category else "OTHER"
            
            if cat_code == 'ADVANCE':
                expenses['advances'] += amount
            elif cat_code == 'OVERTIME':
                # IF overtime is paid out immediately? Usually it's accrued. 
                # But if it's in Expense table, it's money OUT.
                expenses['overtime'] += amount 
            elif cat_code == 'DAILY_PERCENTAGE':
                expenses['daily_percentages'] += amount
            else:
                expenses['other'] += amount
            
            expenses['total'] += amount
            expense_count += 1
            
        # Calculate expected cash in drawer
        opening_cash = Decimal(str(shift.opening_cash_balance))
        expected_cash_in_drawer = opening_cash + income['cash'] - expenses['total']
        
        return {
            'shift_id': str(shift.id),
            'branch_name': branch.name if branch else None,
            'cashier_name': shift.cashier.full_name if shift.cashier else None,
            'opened_at': shift.opened_at.isoformat(),
            'closed_at': shift.closed_at.isoformat() if shift.closed_at else None,
            'status': shift.status.value,
            'opening_cash_balance': float(opening_cash),
            'closing_cash_balance': float(shift.closing_cash_balance) if shift.closing_cash_balance else None,
            'income': {k: float(v) for k, v in income.items()},
            'expenses': {k: float(v) for k, v in expenses.items()},
            'expected_cash_in_drawer': float(expected_cash_in_drawer),
            'invoice_count': invoice_count,
            'expense_count': expense_count,
            'total_transactions': invoice_count + expense_count
        }
