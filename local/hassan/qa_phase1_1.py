import os
import json
import time
import urllib.request
from playwright.sync_api import sync_playwright

WORKSPACE = "/Users/zyad/Projects/hassan-ragab-salon"
OUTPUT_DIR = os.path.join(WORKSPACE, ".local/hassan/visual-qa-phase1-1")
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
        'device_label': 'POS Terminal Phase 1.1',
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
    # Ensure branch 2 has space for device enrollment
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
                        print(f"Revoked stale device {dev_id}")
    except Exception as e:
        print(f"Notice during revoke: {e}")

def run_qa():
    token = get_admin_token()
    revoke_devices(token)

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)

        # ----------------------------------------------------
        # 1. ADMIN INSPECTION (Desktop)
        # ----------------------------------------------------
        admin_ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        admin_page = admin_ctx.new_page()

        print("\n--- ADMIN AUDIT ---")
        admin_page.goto('http://127.0.0.1:3200')
        admin_page.wait_for_timeout(1000)
        admin_page.screenshot(path=os.path.join(OUTPUT_DIR, 'admin-01-login.png'))
        print("✓ admin-01-login.png")

        admin_page.fill('input[type="text"]', admin_creds['login'])
        admin_page.fill('input[type="password"]', admin_creds['password'])
        admin_page.click('button:has-text("دخول")')
        admin_page.wait_for_timeout(3000)

        # Capture Dashboard
        admin_page.screenshot(path=os.path.join(OUTPUT_DIR, 'admin-02-dashboard.png'))
        print("✓ admin-02-dashboard.png (KPI cards & charts)")

        # Zoom into KPI Cards for micro-inspection
        kpi_grid = admin_page.query_selector('[data-omar-kpi-grid]') or admin_page.query_selector('.grid')
        if kpi_grid:
            kpi_grid.screenshot(path=os.path.join(OUTPUT_DIR, 'admin-02-kpi-detail.png'))
            print("✓ admin-02-kpi-detail.png")

        # Navigate to Settings
        settings_btn = admin_page.query_selector('button:has-text("الإعدادات")')
        if settings_btn:
            settings_btn.click()
            admin_page.wait_for_timeout(1500)
            admin_page.screenshot(path=os.path.join(OUTPUT_DIR, 'admin-12-settings-accounts.png'))
            print("✓ admin-12-settings-accounts.png (Account cards & table)")

            # Switch to Devices tab inside settings
            devices_tab = admin_page.query_selector('button:has-text("تأمين الأجهزة")')
            if devices_tab:
                devices_tab.click()
                admin_page.wait_for_timeout(1500)
                admin_page.screenshot(path=os.path.join(OUTPUT_DIR, 'admin-12-settings-devices.png'))
                print("✓ admin-12-settings-devices.png (Device management)")

        # Navigate to Employees
        emp_btn = admin_page.query_selector('button:has-text("إدارة الموظفين")')
        if emp_btn:
            emp_btn.click()
            admin_page.wait_for_timeout(1500)
            admin_page.screenshot(path=os.path.join(OUTPUT_DIR, 'admin-04-employees.png'))
            print("✓ admin-04-employees.png")

        # Navigate to Invoices
        inv_btn = admin_page.query_selector('button:has-text("إدارة الفواتير")')
        if inv_btn:
            inv_btn.click()
            admin_page.wait_for_timeout(1500)
            admin_page.screenshot(path=os.path.join(OUTPUT_DIR, 'admin-07-invoices.png'))
            print("✓ admin-07-invoices.png")

        # Navigate to Treasury
        tr_btn = admin_page.query_selector('button:has-text("الخزينة والماليات")')
        if tr_btn:
            tr_btn.click()
            admin_page.wait_for_timeout(1500)
            admin_page.screenshot(path=os.path.join(OUTPUT_DIR, 'admin-08-treasury.png'))
            print("✓ admin-08-treasury.png")

        # Mobile viewport for Admin
        admin_mobile_ctx = browser.new_context(viewport={'width': 390, 'height': 844})
        admin_mobile_page = admin_mobile_ctx.new_page()
        admin_mobile_page.goto('http://127.0.0.1:3200')
        admin_mobile_page.wait_for_timeout(1000)
        admin_mobile_page.fill('input[type="text"]', admin_creds['login'])
        admin_mobile_page.fill('input[type="password"]', admin_creds['password'])
        admin_mobile_page.click('button:has-text("دخول")')
        admin_mobile_page.wait_for_timeout(3000)
        admin_mobile_page.screenshot(path=os.path.join(OUTPUT_DIR, 'admin-mobile-dashboard.png'))
        print("✓ admin-mobile-dashboard.png (RTL mobile layout)")

        # ----------------------------------------------------
        # 2. MINI CASHIER & ATTENDANCE INSPECTION
        # ----------------------------------------------------
        mini_ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        mini_page = mini_ctx.new_page()

        print("\n--- MINI CASHIER & ATTENDANCE AUDIT ---")
        mini_page.goto('http://127.0.0.1:5276')
        mini_page.wait_for_timeout(1000)
        mini_page.screenshot(path=os.path.join(OUTPUT_DIR, 'mini-01-login.png'))
        print("✓ mini-01-login.png")

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
            mini_page.screenshot(path=os.path.join(OUTPUT_DIR, 'mini-02-device-enrollment.png'))
            print("✓ mini-02-device-enrollment.png")
            eid = enrollment_info['pending_enrollment_id']
            pcode = enrollment_info['pairing_code']
            approve_enrollment(token, 2, eid, pcode)
            print(f"  Approved device enrollment {eid}")
            mini_page.wait_for_timeout(1000)
            mini_page.fill('input[type="password"]', cashier_creds['password'])
            mini_page.click('button:has-text("تسجيل الدخول")')
            mini_page.wait_for_timeout(2000)
            fin_btn = mini_page.query_selector('button:has-text("إكمال تفعيل الجهاز")')
            if fin_btn:
                print("  Finalizing device...")
                fin_btn.click()
                mini_page.wait_for_timeout(3500)
            else:
                mini_page.wait_for_timeout(2000)

        # Cashier Main Screen
        mini_page.screenshot(path=os.path.join(OUTPUT_DIR, 'mini-03-cashier-main.png'))
        print("✓ mini-03-cashier-main.png (Services & cart)")

        # Open Mini Attendance Screen
        # Click sidebar open button
        toggle_sidebar_btn = mini_page.query_selector('button[aria-label*="القائمة"]')
        if toggle_sidebar_btn:
            toggle_sidebar_btn.click()
            mini_page.wait_for_timeout(1000)

        att_btn = mini_page.query_selector('button:has-text("الحضور والانصراف")')
        if att_btn:
            att_btn.click()
            mini_page.wait_for_timeout(2500)
            mini_page.screenshot(path=os.path.join(OUTPUT_DIR, 'mini-08-attendance.png'))
            print("✓ mini-08-attendance.png (Employee attendance cards & search)")

            # Zoom into attendance staff card
            staff_card = mini_page.query_selector('.group.relative') or mini_page.query_selector('.grid > div')
            if staff_card:
                staff_card.screenshot(path=os.path.join(OUTPUT_DIR, 'mini-08-attendance-card-detail.png'))
                print("✓ mini-08-attendance-card-detail.png")

        # Mini Mobile view
        mini_mobile_ctx = browser.new_context(viewport={'width': 390, 'height': 844})
        mini_mobile_page = mini_mobile_ctx.new_page()
        # Navigate to mini
        mini_mobile_page.goto('http://127.0.0.1:5276')
        mini_mobile_page.wait_for_timeout(1500)
        mini_mobile_page.screenshot(path=os.path.join(OUTPUT_DIR, 'mini-mobile-screen.png'))
        print("✓ mini-mobile-screen.png")

        browser.close()
        print("\nAll Visual QA screenshots captured successfully!")

if __name__ == '__main__':
    run_qa()
