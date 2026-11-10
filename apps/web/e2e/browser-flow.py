# Browser end-to-end check of the main screens (Playwright for Python).
#   pip install playwright && playwright install chromium
#   mkdir -p shots && WEB_URL=http://localhost:3001 python e2e/browser-flow.py
import random, time, sys
from playwright.sync_api import sync_playwright, expect

import os
BASE = os.environ.get('WEB_URL', 'http://localhost:3001')
run = hex(int(time.time()))[2:]
def imei():
    body = '35' + ''.join(random.choice('0123456789') for _ in range(12))
    s = 0
    for i in range(14):
        d = int(body[13 - i])
        if i % 2 == 0:
            d *= 2
            if d > 9: d -= 9
        s += d
    return body + str((10 - s % 10) % 10)

errors = []
results = []
def ok(name, cond):
    results.append((name, bool(cond)))
    print(('  PASS ' if cond else '  FAIL ') + name, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_default_timeout(15000)

    # Sign-up
    page.goto(BASE + '/register')
    
    page.get_by_label('Shop name').fill(f'Trinco Mobile {run}')
    page.get_by_text('Phones and computers').click()
    page.get_by_role('button', name='Continue').click()
    page.get_by_label('Your name').fill('Gowry Owner')
    page.get_by_label('Mobile number').fill('0771234567')
    page.get_by_label('Email').fill(f'owner-{run}@demo.lk')
    page.get_by_label('Password', exact=True).fill('Owner@12345')
    page.get_by_role('button', name='Show password').click()
    ok('show-password reveals the text', page.get_by_label('Password', exact=True).get_attribute('type') == 'text')
    page.screenshot(path='shots/r2-account.png')
    page.get_by_role('button', name='Continue').click()
    page.get_by_label('Branch name').fill('Trincomalee Main')
    ok('branch code suggested from the name', page.get_by_label('Short code').input_value() == 'TRI')
    page.screenshot(path='shots/r3-branch.png')
    page.get_by_role('button', name='Create my shop').click()
    page.wait_for_url('**/dashboard')
    page.get_by_text('Today at Trincomalee Main').wait_for()
    ok('register lands on dashboard', True)
    page.screenshot(path='shots/02-dashboard-empty.png')

    # Product: iPhone (serial)
    page.goto(BASE + '/products/new')
    page.get_by_label('Name', exact=True).fill('iPhone 13')
    page.get_by_label('New brand').fill('Apple')
    page.get_by_label('Option', exact=True).fill('128GB Midnight')
    page.get_by_label('SKU', exact=True).fill(f'IP13-{run}')
    page.get_by_label('Price (Rs)', exact=True).fill('185000')
    page.get_by_label('Lowest price (Rs)').fill('175000')
    page.screenshot(path='shots/03-new-product.png', full_page=True)
    page.get_by_role('button', name='Save product').click()
    page.get_by_role('heading', name='iPhone 13').wait_for()
    ok('create serial product', True)

    # Product: glass (quantity)
    page.goto(BASE + '/products/new')
    page.get_by_label('Name', exact=True).fill('Tempered glass')
    page.get_by_label('How is it tracked?').select_option('QUANTITY')
    page.get_by_label('Option', exact=True).fill('iPhone 13')
    page.get_by_label('SKU', exact=True).fill(f'TG-{run}')
    page.get_by_label('Price (Rs)', exact=True).fill('1500')
    page.get_by_label('Reorder at').fill('10')
    page.get_by_role('button', name='Save product').click()
    page.get_by_role('heading', name='Tempered glass').wait_for()
    ok('create quantity product', True)

    # Receive stock
    a, b2, c = imei(), imei(), imei()
    page.goto(BASE + '/stock/receive')
    page.get_by_label('Supplier name').fill('Colombo Distributor')
    page.get_by_label('Add a product').fill('iPhone')
    page.get_by_role('button', name='Add').first.click()
    page.locator('textarea').first.fill(f'{a} {imei()}\n{b2} {imei()}')
    page.get_by_label('Cost each (Rs)').fill('160000')
    page.get_by_label('Add a product').fill('glass')
    page.get_by_role('button', name='Add').first.click()
    page.get_by_label('Quantity').fill('20')
    page.get_by_label('Cost each (Rs)').nth(1).fill('300')
    page.screenshot(path='shots/04-receive.png', full_page=True)
    page.get_by_role('button', name='Record delivery').click()
    page.get_by_text('Delivery recorded').wait_for()
    ok('receive 2 phones + 20 glass', page.get_by_text('2 serialized units added').is_visible())

    page.goto(BASE + '/stock')
    page.get_by_text('Tempered glass iPhone 13').wait_for()
    page.screenshot(path='shots/05-stock.png')

    # POS sale
    page.goto(BASE + '/pos')
    scan = page.get_by_label('Scan or type an IMEI, serial number or barcode')
    scan.fill(a); scan.press('Enter')
    page.get_by_text('Added iPhone 13 128GB Midnight').wait_for()
    page.get_by_label('Search products by name').fill('glass')
    page.get_by_role('button', name='Add', exact=True).nth(1).click()
    page.get_by_text('Added Tempered glass').wait_for()
    page.get_by_label('Customer mobile').fill('0779876543')
    page.get_by_label('Name (new customer)').fill('Nimal Perera')
    page.get_by_label('Amount').fill('190000')
    page.screenshot(path='shots/06-pos-bill.png')
    ok('POS shows change Rs. 3,500.00', page.get_by_text('Rs. 3,500.00').is_visible())
    page.get_by_role('button', name='Complete sale').click()
    page.get_by_role('heading', name='Sale complete').wait_for()
    inv = page.locator('dialog .code').first.inner_text()
    ok(f'sale completed ({inv})', inv == 'TRI-INV-000001')
    page.screenshot(path='shots/07-sale-done.png')
    page.get_by_role('button', name='Next customer').click()
    scan.fill(a); scan.press('Enter')
    page.get_by_text('cannot be sold here').wait_for()
    ok('sold IMEI is refused at POS', True)

    # Repair intake
    page.goto(BASE + '/repairs/new')
    page.get_by_label('Mobile number').fill('0771112223')
    page.get_by_label('Name').fill('Fathima Rizwan')
    page.get_by_label('Brand').fill('Samsung')
    page.get_by_label('Model').fill('Galaxy A54')
    page.get_by_label('IMEI or serial').fill(c)
    page.get_by_label("What is wrong, in the customer's words").fill('Screen cracked, touch not working')
    page.get_by_role('button', name='SIM tray').click()
    page.get_by_label('Screen lock PIN or pattern').fill('2580')
    page.get_by_label('Advance (Rs)').fill('2000')
    page.screenshot(path='shots/08-repair-intake.png', full_page=True)
    page.get_by_role('button', name='Create job card').click()
    page.get_by_text('Job card created').wait_for()
    ok('repair job created', page.get_by_text('TRI-JOB-000001').first.is_visible())
    track_code = page.locator('dt:has-text("Customer tracking code") + dd').inner_text().strip()
    ok(f'tracking code shown on job ({track_code})', len(track_code) == 10)
    page.get_by_role('button', name='Start diagnosis').click()
    page.get_by_role('button', name='Send estimate to customer').wait_for()
    page.get_by_label('Diagnosis').fill('Display assembly broken')
    page.get_by_label('Estimate to customer (Rs)').fill('24500')
    page.get_by_label('Labour charge (Rs)').fill('4500')
    page.get_by_role('button', name='Save diagnosis and charges').click()
    page.wait_for_timeout(800)
    page.get_by_role('button', name='Send estimate to customer').click()
    page.get_by_role('button', name='Customer approved').wait_for()
    page.screenshot(path='shots/09-repair-waiting-approval.png', full_page=True)
    page.get_by_role('button', name='Show passcode').click()
    page.get_by_text('2580', exact=True).wait_for()
    ok('owner can reveal passcode', True)
    page.get_by_role('button', name='Customer approved').click()
    page.get_by_role('button', name='Send to quality check').click()
    page.get_by_role('button', name='Passed, ready for pickup').click()
    page.get_by_role('button', name='Hand over to customer').wait_for()
    page.get_by_role('button', name='Hand over to customer').click()
    dlg = page.locator('dialog[open]')
    dlg.get_by_text('Rs. 2,500.00').first.wait_for()
    ok('hand-over asks for Rs 2,500 (4,500 labour - 2,000 advance)', True)
    page.get_by_role('button', name='Confirm hand-over').click()
    page.get_by_text('Device handed over.').wait_for()
    ok('repair delivered', True)
    page.get_by_role('button', name='Done').click()
    page.wait_for_timeout(800)
    page.screenshot(path='shots/10-repair-delivered.png', full_page=True)
    ok('delivered job keeps Rs 4,500 labour and is fully paid', page.get_by_text('Rs. 4,500.00').first.is_visible() and page.locator('text=Advance refund').count() == 0)

    # Public tracking (separate, signed-out context)
    pub = b.new_context(viewport={'width': 420, 'height': 860}).new_page()
    pub.goto(BASE + '/track?code=' + track_code)
    pub.get_by_label('Mobile number').fill('0771112223')
    pub.get_by_role('button', name='Check status').click()
    pub.get_by_text('Galaxy A54').wait_for()
    ok('public tracking works signed out, shows this shop', pub.get_by_text('Delivered').first.is_visible() and pub.get_by_text(f'Trinco Mobile {run}').is_visible())
    pub.screenshot(path='shots/11-track-mobile.png', full_page=True)

    # Dashboard with data, and mobile POS
    page.goto(BASE + '/dashboard')
    page.get_by_text('Payments by method').wait_for()
    page.wait_for_timeout(500)
    page.screenshot(path='shots/12-dashboard.png', full_page=True)
    m = b.new_context(viewport={'width': 390, 'height': 844}, storage_state=ctx.storage_state()).new_page()
    m.goto(BASE + '/pos')
    m.get_by_label('Scan or type an IMEI, serial number or barcode').wait_for()
    m.screenshot(path='shots/13-pos-mobile.png', full_page=True)

    # Sign out protects pages
    page.get_by_role('button', name='Sign out').click()
    page.wait_for_url('**/login')
    page.goto(BASE + '/sales')
    page.wait_for_url('**/login**')
    ok('signed-out user is sent to login', True)

    b.close()

real_errors = [e for e in errors if '401' not in e and 'Unauthorized' not in e]
print('console errors:', real_errors[:10])
failed = [n for n, r in results if not r]
print(f'{len(results) - len(failed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
