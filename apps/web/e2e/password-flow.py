# Browser check of password reset flows. Needs the API running with NOTIFICATIONS_DRIVER=log
# and its output in a file:  API_LOG=/path/to/api.log python e2e/password-flow.py
import re, time, sys
from playwright.sync_api import sync_playwright
import os
B = os.environ.get('WEB_URL', 'http://localhost:3001'); run = hex(int(time.time()))[2:]
res = []; errs = []
def ok(n, c): res.append(bool(c)); print(('  PASS ' if c else '  FAIL ') + n, flush=True)
def last_code(): return re.findall(r'password reset code is (\d{6})', open(os.environ.get('API_LOG', 'api.log')).read())[-1]
def signin(pg, email, pw):
    pg.goto(B + '/login'); pg.get_by_label('Email').fill(email); pg.get_by_label('Password', exact=True).fill(pw); pg.get_by_role('button', name='Sign in').click()
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}); pg = ctx.new_page(); pg.set_default_timeout(15000)
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    owner = f'pw-owner-{run}@demo.lk'
    pg.goto(B + '/register')
    pg.get_by_label('Shop name').fill(f'Reset Test {run}'); pg.get_by_role('button', name='Continue').click()
    pg.get_by_label('Your name').fill('Owner Person'); pg.get_by_label('Mobile number').fill('0718889990')
    pg.get_by_label('Email').fill(owner); pg.get_by_label('Password', exact=True).fill('Owner@12345')
    pg.get_by_role('button', name='Continue').click(); pg.get_by_label('Branch name').fill('Main')
    pg.get_by_role('button', name='Create my shop').click(); pg.wait_for_url('**/dashboard')

    # owner adds a cashier with a generated temporary password
    pg.goto(B + '/settings'); pg.get_by_role('tab', name='Staff').click()
    pg.get_by_role('button', name='Add staff member').click()
    dlg = pg.locator('dialog[open]')
    dlg.get_by_label('Name').fill('Kumar Cashier'); dlg.get_by_label('Email (used to sign in)').fill(f'pw-cash-{run}@demo.lk')
    temp = dlg.get_by_label('Temporary password').input_value()
    ok(f'temporary password generated ({temp})', re.fullmatch(r'[A-Z][a-z]{3}-\d{4}-[A-Z][a-z]', temp) is not None)
    dlg.get_by_role('button', name='Add staff member').click()
    pg.get_by_text('Temporary password', exact=True).first.wait_for()
    ok('staff list marks the temporary password', True)
    pg.get_by_role('button', name='Sign out').click(); pg.wait_for_url('**/login')

    # cashier is forced to choose a password
    signin(pg, f'pw-cash-{run}@demo.lk', temp)
    pg.wait_for_url('**/account/password')
    pg.get_by_role('heading', name='Choose your own password').wait_for()
    pg.screenshot(path='shots/1-forced-change.png')
    pg.goto(B + '/pos'); pg.wait_for_url('**/account/password')
    ok('cashier cannot open other pages first', True)
    pg.get_by_label('Temporary password').fill(temp)
    pg.get_by_label('New password', exact=True).fill('Kumar@2026')
    pg.get_by_label('Type the new password again').fill('Kumar@2026')
    pg.get_by_role('button', name='Save and continue').click()
    pg.wait_for_url('**/pos')
    ok('after choosing a password the cashier lands on the POS', True)
    pg.get_by_role('button', name='Sign out').click(); pg.wait_for_url('**/login')

    # owner resets the cashier's password from Settings
    signin(pg, owner, 'Owner@12345'); pg.wait_for_url('**/dashboard')
    pg.goto(B + '/settings'); pg.get_by_role('tab', name='Staff').click()
    pg.get_by_role('button', name='Reset password').click()
    pg.locator('dialog[open]').get_by_role('button', name='Set temporary password').click()
    pg.get_by_text('is signed out everywhere').wait_for()
    temp2 = pg.locator('dialog[open] .code').first.inner_text().strip()
    pg.screenshot(path='shots/2-reset-done.png')
    ok(f'owner reset the cashier password ({temp2})', len(temp2) >= 8)
    pg.locator('dialog[open]').get_by_role('button', name='Done').click()
    pg.get_by_role('button', name='Sign out').click(); pg.wait_for_url('**/login')
    signin(pg, f'pw-cash-{run}@demo.lk', 'Kumar@2026')
    pg.get_by_text('Invalid email or password').wait_for()
    ok("cashier's old password no longer works", True)
    signin(pg, f'pw-cash-{run}@demo.lk', temp2); pg.wait_for_url('**/account/password')
    ok('temporary password from the reset signs in and asks for a new one', True)
    ctx.clear_cookies()

    # forgot password by SMS code
    pg.goto(B + '/login'); pg.get_by_label('Email').fill(owner)
    pg.get_by_role('link', name='Forgot password?').click(); pg.wait_for_url('**/forgot-password**')
    ok('email carries over to the reset page', pg.get_by_label('Email').input_value() == owner)
    pg.screenshot(path='shots/3-forgot.png')
    pg.get_by_role('button', name='Send me a code').click()
    pg.get_by_label('6-digit code').wait_for(); time.sleep(1.5)
    code = last_code()
    pg.get_by_label('6-digit code').fill(code)
    pg.get_by_label('New password', exact=True).fill('Owner@54321')
    pg.get_by_label('Type it again').fill('Owner@54321')
    pg.screenshot(path='shots/4-code.png')
    pg.get_by_role('button', name='Set new password').click()
    pg.wait_for_url('**/login?reset=1'); pg.get_by_text('Password changed').wait_for()
    ok('reset by SMS code returns to sign-in with a confirmation', True)
    signin(pg, owner, 'Owner@54321'); pg.wait_for_url('**/dashboard')
    ok('owner signs in with the new password', True)
    b.close()
print('console errors:', [e for e in errs if 'status of 4' not in e])
print(f'{sum(res)} passed, {len(res)-sum(res)} failed'); sys.exit(0 if all(res) else 1)
