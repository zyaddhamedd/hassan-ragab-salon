import os
import json
import time
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright

WORKSPACE = "/Users/zyad/Projects/hassan-ragab-salon"
OUTPUT_DIR = os.path.join(WORKSPACE, ".local/hassan/visual-qa")
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
        'device_label': 'Hassan Ragab Cashier Terminal',
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

def capture_admin(p):
    print("\n--- CAPTURING ADMIN SCREENS ---")
    browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = context.new_page()

    # 1. Login
    page.goto('http://127.0.0.1:3200')
    page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(OUTPUT_DIR, 'admin-01-login.png'))
    print("✓ Captured admin-01-login.png")

    # Perform login
    page.fill('input[type="text"]', admin_creds['login'])
    page.fill('input[type="password"]', admin_creds['password'])
    page.click('button:has-text("دخول")')
    page.wait_for_timeout(3000)

    # 2. Dashboard
    page.screenshot(path=os.path.join(OUTPUT_DIR, 'admin-02-dashboard.png'))
    print("✓ Captured admin-02-dashboard.png")

    tabs = [
        ('services', 'admin-03-services.png', 'إدارة الخدمات'),
        ('employees', 'admin-04-employees.png', 'إدارة الموظفين'),
        ('attendance', 'admin-05-attendance.png', 'متابعة الحضور'),
        ('customers', 'admin-06-customers.png', 'إدارة العملاء'),
        ('invoices', 'admin-07-invoices.png', 'إدارة الفواتير'),
        ('treasury', 'admin-08-treasury.png', 'الخزينة والماليات'),
        ('inventory', 'admin-09-inventory.png', 'مركز الإمداد'),
        ('expenses', 'admin-10-expenses.png', 'المصروفات'),
        ('reports', 'admin-11-reports.png', 'التقارير'),
        ('settings', 'admin-12-settings.png', 'الإعدادات'),
    ]

    for tab_id, filename, label in tabs:
        try:
            # Click the tab button in SideNav or via querySelector
            btn = page.query_selector(f'button:has-text("{label}")') or page.query_selector(f'[data-tab="{tab_id}"]')
            if btn:
                btn.click()
                page.wait_for_timeout(1500)
                page.screenshot(path=os.path.join(OUTPUT_DIR, filename))
                print(f"✓ Captured {filename} ({label})")
            else:
                print(f"⚠ Could not find nav button for {label}")
        except Exception as e:
            print(f"⚠ Error capturing {filename}: {e}")

    browser.close()

def capture_mini(p):
    print("\n--- CAPTURING MINI CASHIER SCREENS ---")
    admin_token = get_admin_token()
    browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = context.new_page()

    # 1. Login Screen
    page.goto('http://127.0.0.1:5276')
    page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(OUTPUT_DIR, 'mini-01-login.png'))
    print("✓ Captured mini-01-login.png")

    # Track pending enrollment during login
    enrollment_info = {}
    def on_response(resp):
        if '/api/mini/auth/login' in resp.url and resp.status == 403:
            try:
                enrollment_info.update(resp.json())
            except Exception:
                pass
    page.on('response', on_response)

    # Fill login
    page.fill('input[type="text"]', cashier_creds['login'])
    page.fill('input[type="password"]', cashier_creds['password'])
    page.click('button:has-text("تسجيل الدخول")')
    page.wait_for_timeout(2500)

    # 2. Check if device enrollment screen shown
    if enrollment_info.get('error') == 'DEVICE_ENROLLMENT_REQUIRED':
        page.screenshot(path=os.path.join(OUTPUT_DIR, 'mini-02-device-enrollment.png'))
        print("✓ Captured mini-02-device-enrollment.png")

        # Approve in Admin
        eid = enrollment_info['pending_enrollment_id']
        pcode = enrollment_info['pairing_code']
        approve_res = approve_enrollment(admin_token, 2, eid, pcode)
        print(f"  Approved device enrollment {eid} (pairing code: {pcode}) -> status: {approve_res.get('status')}")

        page.wait_for_timeout(1000)
        # Click retry / finalize or re-submit
        retry_btn = page.query_selector('button:has-text("إعادة")') or page.query_selector('button:has-text("تأكيد")')
        if retry_btn:
            retry_btn.click()
        else:
            page.fill('input[type="password"]', cashier_creds['password'])
            page.click('button:has-text("تسجيل الدخول")')
        page.wait_for_timeout(3500)

    # 3. Main Cashier Screen
    page.screenshot(path=os.path.join(OUTPUT_DIR, 'mini-03-cashier-main.png'))
    print("✓ Captured mini-03-cashier-main.png")

    # 4. Service Selection / Cart
    # Click on the first service card to add to invoice
    try:
        service_cards = page.query_selector_all('.grid button, .service-card, [data-service-id]')
        if not service_cards:
            service_cards = page.query_selector_all('main button')
        if service_cards and len(service_cards) > 2:
            service_cards[1].click()
            page.wait_for_timeout(1000)
            page.screenshot(path=os.path.join(OUTPUT_DIR, 'mini-04-cashier-cart.png'))
            print("✓ Captured mini-04-cashier-cart.png")
    except Exception as e:
        print(f"⚠ Cart interaction notice: {e}")

    # 5. Open Checkout / Payment Drawer
    try:
        pay_btn = page.query_selector('button:has-text("دفع")') or page.query_selector('button:has-text("تحصيل")') or page.query_selector('button:has-text("إتمام")')
        if pay_btn:
            pay_btn.click()
            page.wait_for_timeout(1500)
            page.screenshot(path=os.path.join(OUTPUT_DIR, 'mini-05-payment-drawer.png'))
            print("✓ Captured mini-05-payment-drawer.png")
            # Close payment drawer/modal with escape or cancel button
            close_btn = page.query_selector('button:has-text("إلغاء")') or page.query_selector('[aria-label="Close"]')
            if close_btn:
                close_btn.click()
                page.wait_for_timeout(1000)
    except Exception as e:
        print(f"⚠ Payment drawer notice: {e}")

    # 6. Navigation to other Mini screens
    mini_navs = [
        ('العملاء', 'mini-06-customers.png'),
        ('الحلاقين', 'mini-07-barbers.png'),
        ('الحضور والانصراف', 'mini-08-attendance.png'),
        ('المصروفات', 'mini-09-expenses.png'),
        ('الخزينة', 'mini-10-treasury.png'),
    ]

    for label, filename in mini_navs:
        try:
            nav_btn = page.query_selector(f'aside button:has-text("{label}")') or page.query_selector(f'nav button:has-text("{label}")') or page.query_selector(f'button:has-text("{label}")')
            if nav_btn:
                nav_btn.click()
                page.wait_for_timeout(1500)
                page.screenshot(path=os.path.join(OUTPUT_DIR, filename))
                print(f"✓ Captured {filename} ({label})")
        except Exception as e:
            print(f"⚠ Nav {label} notice: {e}")

    browser.close()

if __name__ == '__main__':
    with sync_playwright() as p:
        capture_admin(p)
        capture_mini(p)
    print("\nVisual QA capture completed successfully!")
