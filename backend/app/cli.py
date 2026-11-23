"""
CLI commands for administrative tasks and data maintenance.

Register these commands in the main Flask app:
    from app.cli import register_cli_commands
    register_cli_commands(app)
"""

import click
from flask import Flask
from sqlalchemy.sql import text


def register_cli_commands(app: Flask):
    """Register all CLI commands with the Flask app."""

    @app.cli.command('backfill-tip-expenses')
    @click.option('--dry-run', is_flag=True, help='Show what would be updated without changing anything')
    @click.option('--verbose', is_flag=True, help='Show detailed information about each update')
    def backfill_tip_expenses(dry_run: bool, verbose: bool):
        """
        Backfill is_business_expense = FALSE for all existing TIP expenses.

        Matches expenses by:
          1. expense_category_id = TIP_PAYOUT category
          2. notes containing: 'tip', 'باقي', 'تيب', 'tip payout' (case-insensitive)

        Usage:
            flask backfill-tip-expenses                    # Run update
            flask backfill-tip-expenses --dry-run          # Preview what would update
            flask backfill-tip-expenses --verbose          # Show detailed output
            flask backfill-tip-expenses --dry-run --verbose # Preview with details
        """
        from app.extensions import db
        from app.models.expense import Expense
        from app.models.expense_category import ExpenseCategory

        try:
            # Find TIP_PAYOUT category
            tip_category = ExpenseCategory.query.filter_by(code='TIP_PAYOUT').first()
            tip_category_id = tip_category.id if tip_category else None

            if verbose:
                click.echo(f"\n{'='*70}")
                click.echo("TIP Expense Backfill")
                click.echo(f"{'='*70}")
                if tip_category:
                    click.echo(f"✓ Found TIP_PAYOUT category: id={tip_category_id}")
                else:
                    click.echo("⚠ TIP_PAYOUT category not found (will match by notes only)")

            # Query matching expenses
            query = Expense.query

            # Build OR condition for notes matching
            from sqlalchemy import func, or_

            notes_filter = or_(
                func.lower(Expense.notes).ilike('%tip%'),
                func.lower(Expense.notes).ilike('%باقي%'),
                func.lower(Expense.notes).ilike('%تيب%'),
                func.lower(Expense.notes).ilike('%tip payout%'),
            )

            if tip_category_id:
                query = query.filter(
                    (Expense.expense_category_id == tip_category_id) | notes_filter
                )
            else:
                query = query.filter(notes_filter)

            matching_expenses = query.all()
            count = len(matching_expenses)

            if verbose:
                click.echo(f"\nMatching expenses found: {count}")
                if matching_expenses:
                    click.echo("\nDetails:")
                    for exp in matching_expenses:
                        category_code = exp.expense_category.code if exp.expense_category else "N/A"
                        click.echo(
                            f"  • ID={exp.id}, Amount={exp.amount}, "
                            f"Category={category_code}, Notes='{exp.notes}'"
                        )

            if dry_run:
                click.echo(f"\n[DRY RUN] Would update {count} expenses to is_business_expense=FALSE")
                click.echo("Run without --dry-run to apply changes")
            else:
                if count == 0:
                    click.echo("\n✓ No matching TIP expenses found - nothing to update")
                else:
                    # Apply the update
                    for exp in matching_expenses:
                        exp.is_business_expense = False

                    db.session.commit()
                    click.echo(f"\n✓ Successfully updated {count} expenses to is_business_expense=FALSE")

            click.echo(f"{'='*70}\n")

        except Exception as e:
            click.echo(f"\n✗ Error during backfill: {str(e)}", err=True)
            if not dry_run:
                db.session.rollback()
            raise

    @app.cli.command('check-tip-expenses')
    def check_tip_expenses():
        """
        Check current state of TIP expenses without making changes.

        Shows:
          - Total TIP expenses
          - How many have is_business_expense = TRUE vs FALSE
          - Sample expense records
        """
        from app.extensions import db
        from app.models.expense import Expense
        from app.models.expense_category import ExpenseCategory

        try:
            # Find TIP_PAYOUT category
            tip_category = ExpenseCategory.query.filter_by(code='TIP_PAYOUT').first()

            click.echo(f"\n{'='*70}")
            click.echo("TIP Expense Report")
            click.echo(f"{'='*70}\n")

            if not tip_category:
                click.echo("⚠ TIP_PAYOUT category not found")
            else:
                # Query by category
                tips_by_category = Expense.query.filter_by(
                    expense_category_id=tip_category.id
                ).all()

                business_true = sum(1 for e in tips_by_category if e.is_business_expense)
                business_false = sum(1 for e in tips_by_category if not e.is_business_expense)

                click.echo(f"TIP_PAYOUT Category Expenses:")
                click.echo(f"  Total: {len(tips_by_category)}")
                click.echo(f"  is_business_expense=TRUE:  {business_true}")
                click.echo(f"  is_business_expense=FALSE: {business_false}")

                if tips_by_category:
                    click.echo(f"\n  Sample records:")
                    for exp in tips_by_category[:5]:
                        status = "✓ FALSE" if not exp.is_business_expense else "✗ TRUE"
                        click.echo(
                            f"    • ID={exp.id}, Amount={exp.amount}, "
                            f"is_business_expense={status}, Notes='{exp.notes}'"
                        )

            # Also check notes-based matches
            from sqlalchemy import func, or_

            notes_filter = or_(
                func.lower(Expense.notes).ilike('%tip%'),
                func.lower(Expense.notes).ilike('%باقي%'),
                func.lower(Expense.notes).ilike('%تيب%'),
                func.lower(Expense.notes).ilike('%tip payout%'),
            )

            tips_by_notes = Expense.query.filter(notes_filter).all()

            if tips_by_notes:
                click.echo(f"\nNotes-based TIP Matches:")
                click.echo(f"  Total: {len(tips_by_notes)}")
                business_true = sum(1 for e in tips_by_notes if e.is_business_expense)
                business_false = sum(1 for e in tips_by_notes if not e.is_business_expense)
                click.echo(f"  is_business_expense=TRUE:  {business_true}")
                click.echo(f"  is_business_expense=FALSE: {business_false}")

            click.echo(f"\n{'='*70}\n")

        except Exception as e:
            click.echo(f"\n✗ Error checking TIP expenses: {str(e)}", err=True)
            raise

    @app.cli.command('init-production-data')
    @click.option('--email', envvar='INITIAL_ADMIN_EMAIL', help='Initial SUPER_ADMIN login email/username')
    @click.option('--password', envvar='INITIAL_ADMIN_PASSWORD', help='Initial SUPER_ADMIN password (never logged)')
    @click.option('--display-name', envvar='INITIAL_ADMIN_NAME', default='Hassan Ragab Administrator', help='Admin display name')
    @click.option('--branch-name', envvar='INITIAL_BRANCH_NAME', default='Hassan Ragab Salon', help='Initial operating branch name')
    @click.option('--branch-city', envvar='INITIAL_BRANCH_CITY', default='Giza', help='Initial operating branch city')
    def init_production_data(email, password, display_name, branch_name, branch_city):
        """
        Idempotent production bootstrap command.
        Creates initial operating branch and initial SUPER_ADMIN user if none exist.
        Credentials are read from CLI options or environment variables (INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD).
        Never logs passwords. Safe to run multiple times.
        """
        import os
        from app.extensions import db
        from app.models import Branch, User, UserRole

        try:
            click.echo(f"\n{'='*70}")
            click.echo("Hassan Ragab Salon — Production Bootstrap")
            click.echo(f"{'='*70}")

            # 1. Operating Branch Provisioning
            operating_branch = Branch.query.filter_by(is_main_warehouse=False).first()
            if operating_branch:
                click.echo(f"[INFO] Operating branch already exists: '{operating_branch.name}' (id={operating_branch.id}). Skipping.")
            else:
                branch = Branch(
                    name=branch_name.strip(),
                    city=branch_city.strip(),
                    is_active=True,
                    is_main_warehouse=False,
                    allow_discounts=True
                )
                db.session.add(branch)
                db.session.flush()
                click.echo(f"[SUCCESS] Created operating branch: '{branch.name}' in '{branch.city}' (id={branch.id})")

            # 2. SUPER_ADMIN Provisioning
            super_admin = User.query.filter_by(role=UserRole.SUPER_ADMIN).first()
            if super_admin:
                click.echo(f"[INFO] SUPER_ADMIN already exists: '{super_admin.email}' (id={super_admin.id}). Skipping.")
            else:
                if not email or not email.strip():
                    click.echo("[ERROR] INITIAL_ADMIN_EMAIL is required to create the initial admin.", err=True)
                    db.session.rollback()
                    raise click.ClickException("Missing INITIAL_ADMIN_EMAIL")
                if not password or len(password.strip()) < 4:
                    click.echo("[ERROR] INITIAL_ADMIN_PASSWORD is required (at least 4 chars) to create the initial admin.", err=True)
                    db.session.rollback()
                    raise click.ClickException("Missing or too short INITIAL_ADMIN_PASSWORD")

                admin = User(
                    full_name=display_name.strip(),
                    email=email.strip(),
                    role=UserRole.SUPER_ADMIN,
                    branch_id=None,
                    is_active=True
                )
                admin.set_password(password.strip())
                db.session.add(admin)
                db.session.flush()
                click.echo(f"[SUCCESS] Created SUPER_ADMIN user: '{admin.email}' (name='{admin.full_name}', id={admin.id})")

            db.session.commit()
            click.echo("[SUCCESS] Production bootstrap completed successfully.")
            click.echo(f"{'='*70}\n")
        except Exception as e:
            db.session.rollback()
            click.echo(f"[ERROR] Production bootstrap failed: {e}", err=True)
            raise

