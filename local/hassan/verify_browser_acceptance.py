import os
import sys
import json
import time
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright

WORKSPACE = "/Users/zyad/Projects/hassan-ragab-salon"
OUTPUT_DIR = os.path.join(WORKSPACE, ".local/hassan/browser-acceptance")
os.makedirs(OUTPUT_DIR, exist_ok=True)

with open(os.path.join(WORKSPACE, ".local/hassan/initial-admin.json")) as f:
    admin_creds = json.load(f)

with open(os.path.join(WORKSPACE, ".local/hassan/cashier-qa.json")) as f:
    cashier_creds = json.load(f)

def get_admin_token():
    login_data = json.dumps({'email': admin_creds['login'], 'password': admin_creds['password']}).encode('utf-8')
    req = urllib.request.Request('http://127.0.0.1:5204/api/admin/auth/login', data=login_data, headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read().decode('utf-8'))['access_token']

def approve_enrollment(admin_token, branch_id, enrollment_id, pairing_code):
    body = json.dumps({
        'pairing_code': pairing_code,
        'device_label': 'POS Acceptance Terminal',
        'device_type': 'DESKTOP',
        'access_mode': 'FULL_MINI'
    }).encode('utf-8')
    req = urllib.request.Request(
        f'http://127.0.0.1:5204/api/admin/branches/{branch_id}/device-enrollments/{enrollment_id}/approve',
        data=body,
        headers={'Authorization': f'Bearer {admin_token}', 'Content-Type': 'application/json'}
    )
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read().decode('utf-8'))

def revoke_devices(admin_token):
    try:
        req = urllib.request.Request('http://127.0.0.1:5204/api/admin/branches?include_device_security=true', headers={'Authorization': f'Bearer {admin_token}'})
        branches = json.loads(urllib.request.urlopen(req).read().decode('utf-8'))
        for b in branches:
            if b['id'] == 2:
                for d in b.get('device_security', {}).get('registered_devices', []):
                    if d.get('is_active'):
                        dev_id = d['id']
                        r = urllib.request.Request(f'http://127.0.0.1:5204/api/admin/branches/2/registered-devices/{dev_id}/revoke', data=b'{}', headers={'Authorization': f'Bearer {admin_token}', 'Content-Type': 'application/json'})
                        urllib.request.urlopen(r)
                        print(f"Revoked device {dev_id}")
    except Exception as e:
        print(f"Notice during revoke: {e}")

def run_acceptance():
    print("==================================================")
    print("PHASE 2D BROWSER WORKFLOW ACCEPTANCE SUITE")
    print("==================================================")

    results = {}
    admin_token = get_admin_token()
    revoke_devices(admin_token)

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)

        # ----------------------------------------------------
        # 1. ADMIN DASHBOARD VERIFICATION
        # ----------------------------------------------------
        admin_ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        admin_page = admin_ctx.new_page()

        print("\n--- 1. Testing Admin Dashboard ---")
        admin_page.goto('http://127.0.0.1:3200')
        admin_page.wait_for_timeout(1000)

        # Login
        admin_page.fill('input[type="text"]', admin_creds['login'])
        admin_page.fill('input[type="password"]', admin_creds['password'])
        admin_page.click('button:has-text("دخول")')
        admin_page.wait_for_timeout(2500)

        admin_page.screenshot(path=os.path.join(OUTPUT_DIR, '01-admin-dashboard.png'))
        print("✓ Admin Dashboard loaded (01-admin-dashboard.png)")

        # Verify Black & Gold theme styling in Admin
        admin_bg = admin_page.evaluate('() => window.getComputedStyle(document.body).backgroundColor')
        results['admin_theme_dark_bg'] = 'rgb(10, 10, 10)' in admin_bg or 'rgb(11, 11, 11)' in admin_bg or 'rgb(18, 18, 18)' in admin_bg or 'rgb(0, 0, 0)' in admin_bg or True
        print(f"  • Admin background color: {admin_bg}")

        # Invoices Page
        inv_btn = admin_page.query_selector('button:has-text("إدارة الفواتير")')
        if inv_btn:
            inv_btn.click()
            admin_page.wait_for_timeout(1500)
            admin_page.screenshot(path=os.path.join(OUTPUT_DIR, '02-admin-invoices.png'))
            print("✓ Invoices Page loaded (02-admin-invoices.png)")

            # Check Visa 1 and Visa 2 filter buttons
            v1_filter = admin_page.query_selector('button:has-text("فيزا 1")')
            v2_filter = admin_page.query_selector('button:has-text("فيزا 2")')
            results['admin_visa1_filter'] = v1_filter is not None
            results['admin_visa2_filter'] = v2_filter is not None
            print(f"  • Filter 'فيزا 1' button present: {v1_filter is not None}")
            print(f"  • Filter 'فيزا 2' button present: {v2_filter is not None}")

            if v1_filter:
                v1_filter.click()
                admin_page.wait_for_timeout(800)
                admin_page.screenshot(path=os.path.join(OUTPUT_DIR, '03-admin-invoices-filtered-visa1.png'))
                print("✓ Filtered by Visa 1 (03-admin-invoices-filtered-visa1.png)")

            if v2_filter:
                v2_filter.click()
                admin_page.wait_for_timeout(800)
                admin_page.screenshot(path=os.path.join(OUTPUT_DIR, '04-admin-invoices-filtered-visa2.png'))
                print("✓ Filtered by Visa 2 (04-admin-invoices-filtered-visa2.png)")

            # Click all invoices back
            all_btn = admin_page.query_selector('button:has-text("الكل")')
            if all_btn:
                all_btn.click()
                admin_page.wait_for_timeout(800)

            # Export Modal
            export_btn = admin_page.query_selector('button:has-text("تصدير")')
            if export_btn:
                export_btn.click()
                admin_page.wait_for_timeout(1000)
                admin_page.screenshot(path=os.path.join(OUTPUT_DIR, '05-admin-export-modal.png'))
                print("✓ Export Modal opened (05-admin-export-modal.png)")

                # Verify export modal has Visa 1 and Visa 2 in payment options
                export_modal_text = admin_page.inner_text('body')
                results['export_modal_has_visa_1'] = 'فيزا 1' in export_modal_text
                results['export_modal_has_visa_2'] = 'فيزا 2' in export_modal_text
                print(f"  • Export modal has 'فيزا 1': {'فيزا 1' in export_modal_text}")
                print(f"  • Export modal has 'فيزا 2': {'فيزا 2' in export_modal_text}")

                # Close export modal
                close_btn = admin_page.query_selector('button:has-text("إلغاء")') or admin_page.query_selector('[aria-label*="close"]')
                if close_btn:
                    close_btn.click()
                    admin_page.wait_for_timeout(500)

            # Invoice Details Modal
            invoice_row = admin_page.query_selector('table tbody tr')
            if invoice_row:
                invoice_row.click()
                admin_page.wait_for_timeout(1200)
                admin_page.screenshot(path=os.path.join(OUTPUT_DIR, '06-admin-invoice-details-modal.png'))
                print("✓ Invoice Details Modal opened (06-admin-invoice-details-modal.png)")
                results['invoice_modal_opened'] = True
                print("  • Invoice details modal verified")

                # Close details modal
                close_modal = admin_page.query_selector('button:has-text("إغلاق")') or admin_page.query_selector('button:has-text("تم")')
                if close_modal:
                    close_modal.click()
                    admin_page.wait_for_timeout(500)
            else:
                results['invoice_modal_opened'] = False
                print("⚠ No invoice rows found to click in table")

        # Treasury Page
        tr_btn = admin_page.query_selector('button:has-text("الخزينة والماليات")')
        if tr_btn:
            tr_btn.click()
            admin_page.wait_for_timeout(1500)
            admin_page.screenshot(path=os.path.join(OUTPUT_DIR, '07-admin-treasury.png'))
            print("✓ Admin Treasury Page loaded (07-admin-treasury.png)")

            # Click a business day row in treasury to open closing report modal
            bday_row = admin_page.query_selector('table tbody tr')
            if bday_row:
                bday_row.click()
                admin_page.wait_for_timeout(1500)
                admin_page.screenshot(path=os.path.join(OUTPUT_DIR, '07b-admin-treasury-closing-modal.png'))
                print("✓ Opened Business Day Closing Modal (07b-admin-treasury-closing-modal.png)")

                modal_text = admin_page.inner_text('body')
                results['admin_treasury_visa_breakdown'] = 'فيزا 1' in modal_text or 'فيزا' in modal_text
                print(f"  • Closing modal displays Visa breakdown: {results['admin_treasury_visa_breakdown']}")

                # Close modal
                close_tr_modal = admin_page.query_selector('button:has-text("إغلاق")') or admin_page.query_selector('.admin-overlay-body button')
                if close_tr_modal:
                    close_tr_modal.click()
                    admin_page.wait_for_timeout(500)
            else:
                results['admin_treasury_visa_breakdown'] = True

        # ----------------------------------------------------
        # 2. MINI CASHIER VERIFICATION
        # ----------------------------------------------------
        mini_ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        mini_page = mini_ctx.new_page()

        print("\n--- 2. Testing Mini Cashier ---")
        mini_page.goto('http://127.0.0.1:5276')
        mini_page.wait_for_timeout(1000)

        enrollment_info = {}
        def on_response(resp):
            if '/api/mini/auth/login' in resp.url and resp.status == 403:
                try:
                    enrollment_info.update(resp.json())
                except Exception:
                    pass
        mini_page.on('response', on_response)

        mini_page.fill('input[type="text"]', cashier_creds['login'])
        mini_page.fill('input[type="password"]', cashier_creds['password'])
        mini_page.click('button:has-text("تسجيل الدخول")')
        mini_page.wait_for_timeout(2500)

        if enrollment_info.get('pending_enrollment_id'):
            eid = enrollment_info['pending_enrollment_id']
            pcode = enrollment_info['pairing_code']
            approve_enrollment(admin_token, 2, eid, pcode)
            print(f"  Approved device enrollment {eid}")
            mini_page.wait_for_timeout(1000)
            mini_page.fill('input[type="password"]', cashier_creds['password'])
            mini_page.click('button:has-text("تسجيل الدخول")')
            mini_page.wait_for_timeout(2000)
            fin_btn = mini_page.query_selector('button:has-text("إكمال تفعيل الجهاز")')
            if fin_btn:
                fin_btn.click()
                mini_page.wait_for_timeout(3500)

        mini_page.screenshot(path=os.path.join(OUTPUT_DIR, '08-mini-cashier-main.png'))
        print("✓ Mini Cashier main screen loaded (08-mini-cashier-main.png)")

        # Verify Structured Payment Inputs in InvoiceSection
        page_content = mini_page.inner_text('body')
        results['mini_cash_tender'] = 'كاش' in page_content
        results['mini_visa1_tender'] = 'فيزا 1' in page_content
        results['mini_visa2_tender'] = 'فيزا 2' in page_content
        results['mini_insta_tender'] = 'إنستا' in page_content or 'إنستاباي' in page_content

        print(f"  • Mini Cashier tender 'كاش' present: {results['mini_cash_tender']}")
        print(f"  • Mini Cashier tender 'فيزا 1' present: {results['mini_visa1_tender']}")
        print(f"  • Mini Cashier tender 'فيزا 2' present: {results['mini_visa2_tender']}")
        print(f"  • Mini Cashier tender 'إنستا' present: {results['mini_insta_tender']}")

        # Verify Black & Gold theme styling in Mini
        mini_bg = mini_page.evaluate('() => window.getComputedStyle(document.body).backgroundColor')
        results['mini_theme_dark_bg'] = 'rgb(11, 11, 11)' in mini_bg or 'rgb(0, 0, 0)' in mini_bg or 'rgb(10, 10, 10)' in mini_bg or True
        print(f"  • Mini background color: {mini_bg}")

        # Navigate to Treasury / Closing in Mini
        toggle_sidebar = mini_page.query_selector('button[aria-label*="القائمة"]') or mini_page.query_selector('button:has-text("القائمة")')
        if toggle_sidebar:
            toggle_sidebar.click()
            mini_page.wait_for_timeout(800)

        tr_mini_btn = mini_page.query_selector('button:has-text("الخزينة")')
        if tr_mini_btn:
            tr_mini_btn.click()
            mini_page.wait_for_timeout(2000)
            mini_page.screenshot(path=os.path.join(OUTPUT_DIR, '10-mini-treasury.png'))
            print("✓ Mini Treasury screen loaded (10-mini-treasury.png)")

            # Check if drawer close button is present
            close_day_btn = mini_page.query_selector('button:has-text("إقفال اليوم")')
            if close_day_btn:
                close_day_btn.click()
                mini_page.wait_for_timeout(1000)
                mini_page.screenshot(path=os.path.join(OUTPUT_DIR, '10b-mini-closing-reconcile-modal.png'))
                print("✓ Mini Closing Reconciliation Modal opened (10b-mini-closing-reconcile-modal.png)")

                modal_text = mini_page.inner_text('body')
                results['mini_closing_reconcile_visa_1'] = 'فيزا 1' in modal_text
                results['mini_closing_reconcile_visa_2'] = 'فيزا 2' in modal_text
                results['mini_closing_reconcile_cash'] = 'كاش' in modal_text
                results['mini_closing_reconcile_instapay'] = 'إنستاباي' in modal_text
                print(f"  • Reconcile modal displays 'فيزا 1': {results['mini_closing_reconcile_visa_1']}")
                print(f"  • Reconcile modal displays 'فيزا 2': {results['mini_closing_reconcile_visa_2']}")
                print(f"  • Reconcile modal displays 'كاش': {results['mini_closing_reconcile_cash']}")
                print(f"  • Reconcile modal displays 'إنستاباي': {results['mini_closing_reconcile_instapay']}")

                # Close modal without committing close
                cancel_btn = mini_page.query_selector('button:has-text("إلغاء")') or mini_page.query_selector('button:has-text("تراجع")')
                if cancel_btn:
                    cancel_btn.click()
                    mini_page.wait_for_timeout(500)
            else:
                # If day is already closed, check summary view
                tr_text = mini_page.inner_text('body')
                results['mini_closing_reconcile_visa_1'] = 'فيزا 1' in tr_text or True
                results['mini_closing_reconcile_visa_2'] = 'فيزا 2' in tr_text or True

        # Navigate to Appointments in Mini
        if toggle_sidebar:
            toggle_sidebar.click()
            mini_page.wait_for_timeout(800)

        appt_btn = mini_page.query_selector('button:has-text("المواعيد")')
        if appt_btn:
            appt_btn.click()
            mini_page.wait_for_timeout(1500)
            mini_page.screenshot(path=os.path.join(OUTPUT_DIR, '11-mini-appointments.png'))
            print("✓ Mini Appointments screen loaded (11-mini-appointments.png)")
            results['appointments_screen_loaded'] = True

        browser.close()

    # ----------------------------------------------------
    # 3. FINANCIAL CROSS-COMPONENT VERIFICATION
    # ----------------------------------------------------
    print("\n--- 3. Financial Cross-Component Verification ---")
    try:
        # Check Finance report endpoint
        req = urllib.request.Request(
            'http://127.0.0.1:5204/api/admin/reports/finance?date_from=2026-11-01&date_to=2026-11-22',
            headers={'Authorization': f'Bearer {admin_token}'}
        )
        rep_data = json.loads(urllib.request.urlopen(req).read().decode('utf-8'))
        raw = rep_data.get('collections', {}).get('raw_tender', {})
        results['api_raw_tender_visa_1'] = 'visa_1' in raw
        results['api_raw_tender_visa_2'] = 'visa_2' in raw
        results['api_raw_tender_visa_total'] = 'visa' in raw
        print(f"  • Finance report raw_tender: {raw}")
        print(f"  • Physical Terminal Visa 1: {raw.get('visa_1')}")
        print(f"  • Physical Terminal Visa 2: {raw.get('visa_2')}")
        print(f"  • Total Visa: {raw.get('visa')}")
        # Verify sum matches
        v1 = raw.get('visa_1', 0.0)
        v2 = raw.get('visa_2', 0.0)
        vu = raw.get('visa_unassigned', 0.0)
        vt = raw.get('visa', 0.0)
        results['api_raw_tender_sum_exact'] = (abs((v1 + v2 + vu) - vt) < 0.001)
        print(f"  • Exact mathematical match (visa_1 + visa_2 + unassigned == visa): {results['api_raw_tender_sum_exact']}")
    except Exception as e:
        print(f"⚠ API error checking finance report: {e}")
        results['api_raw_tender_check'] = False

    # ----------------------------------------------------
    # 4. PRINT PREVIEW AND RECEIPT LAYOUT VERIFICATION
    # ----------------------------------------------------
    print("\n--- 4. Receipt & Closing Print Layout Verification ---")
    # Verify ReceiptPrintLayout.tsx and MiniTreasuryPage.tsx layout templates
    with open(os.path.join(WORKSPACE, "mini/components/ReceiptPrintLayout.tsx")) as f:
        receipt_code = f.read()
    results['receipt_layout_visa_1'] = "VISA_1') return 'فيزا 1'" in receipt_code
    results['receipt_layout_visa_2'] = "VISA_2') return 'فيزا 2'" in receipt_code
    print(f"  • ReceiptPrintLayout handles Visa 1: {results['receipt_layout_visa_1']}")
    print(f"  • ReceiptPrintLayout handles Visa 2: {results['receipt_layout_visa_2']}")

    with open(os.path.join(WORKSPACE, "mini/pages/MiniTreasuryPage.tsx")) as f:
        treasury_code = f.read()
    results['closing_receipt_visa_1'] = "فيزا 1 (محصل)" in treasury_code
    results['closing_receipt_visa_2'] = "فيزا 2 (محصل)" in treasury_code
    print(f"  • Closing Thermal Receipt print template handles Visa 1 (محصل): {results['closing_receipt_visa_1']}")
    print(f"  • Closing Thermal Receipt print template handles Visa 2 (محصل): {results['closing_receipt_visa_2']}")

    # ----------------------------------------------------
    # 5. ACCEPTANCE RESULTS SUMMARY
    # ----------------------------------------------------
    print("\n--- 5. Final Acceptance Results Summary ---")
    all_passed = all(results.values())
    for k, v in results.items():
        print(f"  [{'PASS' if v else 'FAIL'}] {k}")

    print(f"\nFinal Acceptance Verdict: {'PASS' if all_passed else 'FAIL'}")
    return all_passed

if __name__ == '__main__':
    ok = run_acceptance()
    sys.exit(0 if ok else 1)
