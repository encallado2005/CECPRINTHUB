"""CECPRINTHUB interactions written in Python with PyScript (no custom JavaScript)."""
import json
from datetime import date, datetime
from js import document, window, localStorage, sessionStorage
from pyodide.ffi import create_proxy

USERS_KEY, ORDERS_KEY, SESSION_KEY = 'cph_users_v1', 'cph_orders_v1', 'cph_session_v1'
ADMIN_EMAIL, ADMIN_PASSWORD = 'janry@gmail.com', 'Encallado123'
history_stack, proxies = [], []
draft_order, active_user = None, None

def el(selector): return document.querySelector(selector)
def all_(selector): return document.querySelectorAll(selector)
def read_store(key, default):
    try: return json.loads(localStorage.getItem(key) or json.dumps(default))
    except Exception: return default
def write_store(key, value): localStorage.setItem(key, json.dumps(value))
def users(): return read_store(USERS_KEY, [])
def orders(): return read_store(ORDERS_KEY, [])
def safe(value):
    return str(value if value is not None else '').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;').replace("'",'&#39;')
def bind(node, event, callback):
    proxy = create_proxy(callback); proxies.append(proxy); node.addEventListener(event, proxy)
def bind_all(selector, event, callback):
    for node in all_(selector): bind(node, event, lambda e, n=node: callback(e, n))
def toast(message):
    t=el('#toast'); t.textContent=message; t.classList.add('show')
    window.setTimeout(create_proxy(lambda: t.classList.remove('show')), 3200)
def auth_message(message):
    el('#auth-message').textContent=message; el('#auth-message').classList.remove('hidden')
def set_auth_tab(tab):
    for b in all_('[data-auth]'): b.classList.toggle('active', b.getAttribute('data-auth') == tab)
    for name in ['login','register','admin']: el('#'+name+'-form').classList.toggle('hidden', name != tab)
    el('#auth-message').classList.add('hidden')
def update_header():
    document.body.classList.toggle('admin-mode', bool(active_user and active_user.get('role')=='admin'))
    if active_user:
        el('#session-label').textContent = 'Admin panel' if active_user.get('role')=='admin' else 'Hi, '+active_user.get('name','Customer').split(' ')[0]
        el('#logout-btn').classList.remove('hidden')
    else:
        el('#session-label').textContent=''; el('#logout-btn').classList.add('hidden')
def page(name, push=True):
    target=name+'-page'
    if not el('#'+target): name='home'; target='home-page'
    if push:
        for p in all_('.page'):
            if not p.classList.contains('hidden') and p.id != target: history_stack.append(p.id.replace('-page','')); break
    for p in all_('.page'): p.classList.toggle('hidden', p.id != target)
    window.scrollTo(0,0)
    if name=='orders': render_my_orders()
    if name=='admin': render_admin()
    if name=='home': render_customer_notice()
    update_header()
def back(event=None, node=None):
    if history_stack: page(history_stack.pop(), False)
    elif active_user and active_user.get('role')=='admin': page('admin',False)
    elif active_user: page('home',False)
    else: page('auth',False)
def login_user(user):
    global active_user
    active_user=dict(user); write_store(SESSION_KEY,active_user); history_stack.clear(); update_header()
    page('admin' if user.get('role')=='admin' else 'home',False)
    toast('Welcome, admin.' if user.get('role')=='admin' else 'Welcome to CECPRINTHUB!')
def logout(event=None):
    global active_user
    # Yes = confirm logout and return to login. No = remain on the current page.
    if not window.confirm('Are you sure you want to log out?\\n\\nChoose OK to log out, or Cancel to stay on this page.'):
        return
    active_user=None; localStorage.removeItem(SESSION_KEY); history_stack.clear(); set_auth_tab('login'); page('auth',False); toast('You have logged out. See you again soon!')
def value(selector): return el(selector).value
def login_submit(event):
    event.preventDefault(); email=value('#login-email').strip().lower(); password=value('#login-password')
    if email==ADMIN_EMAIL and password==ADMIN_PASSWORD:
        login_user({'name':'Administrator','email':ADMIN_EMAIL,'role':'admin'}); return
    match=next((u for u in users() if u.get('email')==email and u.get('password')==password),None)
    if not match: auth_message('Email or password is incorrect. If you are new, create an account first.')
    else: login_user(match)
def register_submit(event):
    event.preventDefault(); name=value('#reg-name').strip(); email=value('#reg-email').strip().lower(); password=value('#reg-password')
    current=users()
    if any(u.get('email')==email for u in current): auth_message('An account with this email already exists. Please log in.'); return
    current.append({'name':name,'email':email,'password':password,'role':'customer'}); write_store(USERS_KEY,current)
    el('#register-form').reset(); login_user({'name':name,'email':email,'role':'customer'})
def admin_submit(event):
    event.preventDefault()
    if value('#admin-email').strip().lower()!=ADMIN_EMAIL or value('#admin-password')!=ADMIN_PASSWORD:
        auth_message('Admin email or password is incorrect.'); return
    login_user({'name':'Administrator','email':ADMIN_EMAIL,'role':'admin'})
def go(event,node):
    name=node.getAttribute('data-go')
    if name in ['home','order','checkout','orders'] and not active_user:
        page('auth'); auth_message('Please log in or create an account to continue.'); return
    if name=='order':
        el('#service-type').value=(draft_order or {}).get('service',''); page('order')
    else: page(name)
def choose_service(event,node):
    global draft_order
    if not active_user or active_user.get('role')!='customer': page('auth'); return
    draft_order={'service':node.getAttribute('data-service')}; el('#service-type').value=draft_order['service']; page('order')
def order_submit(event):
    global draft_order
    event.preventDefault()
    file_input=el('#order-file')
    files=file_input.files
    if not files.length:
        toast('Please attach your print file before continuing.')
        file_input.focus()
        return
    file=files.item(0)
    # Keep demo storage within reasonable browser localStorage limits.
    if file.size > 2 * 1024 * 1024:
        toast('Please choose a file smaller than 2 MB for this demo.')
        return
    if not all([value('#service-type'), value('#details').strip(), value('#pickup-date'), value('#pickup-time'), value('#quantity')]):
        toast('Please complete all required fields.')
        return
    draft_order={'service':value('#service-type'),'quantity':int(value('#quantity') or 1),'details':value('#details').strip(),
      'fileName':file.name,'fileType':file.type or 'application/octet-stream','fileData':'',
      'pickupDate':value('#pickup-date'),'pickupTime':value('#pickup-time')}
    reader=window.FileReader.new()
    def loaded(evt):
        draft_order['fileData']=str(reader.result)
        render_summary()
        page('checkout')
    bind(reader,'load',loaded)
    bind(reader,'error',lambda evt: toast('Sorry, the file could not be read. Please select it again.'))
    reader.readAsDataURL(file)
def render_summary():
    entries=[('Service',draft_order['service']),('Quantity',draft_order['quantity']),('Print details',draft_order['details']),('File',draft_order['fileName']),('Pickup date',draft_order['pickupDate']),('Pickup time',draft_order['pickupTime']),('Collection','In-store pickup only — no delivery')]
    el('#order-summary').innerHTML=''.join('<div class="summary-item '+('wide' if k in ['Print details','Collection'] else '')+'"><small>'+safe(k)+'</small><b>'+safe(v)+'</b></div>' for k,v in entries)
    if draft_order.get('fileData'):
        el('#order-summary').insertAdjacentHTML('beforeend','<a class="file-open-link" href="'+safe(draft_order['fileData'])+'" target="_blank" rel="noopener" download="'+safe(draft_order['fileName'])+'">↗ Open attached file</a>')
def submit_order(event=None):
    global draft_order
    if not active_user or not draft_order: toast('Please log in and complete your order first.'); page('auth'); return
    items=orders(); order={'id':'CPH-'+str(int(datetime.now().timestamp()*1000))[-7:],'userEmail':active_user['email'],'userName':active_user['name'],'createdAt':datetime.now().isoformat(),**draft_order,'noted':False}
    items.insert(0,order); write_store(ORDERS_KEY,items); draft_order=None; el('#order-form').reset()
    toast('Ordered Successfully, See you soon'); page('orders',False); render_my_orders()
def render_customer_notice():
    if not active_user or active_user.get('role')!='customer': return
    noted=[o for o in orders() if o.get('userEmail')==active_user['email'] and o.get('noted')]
    seen=read_store('cph_seen_notices',[]); fresh=[o for o in noted if o['id'] not in seen]
    el('#customer-notice').textContent=('Admin update: Your order is noted'+(f' ({len(fresh)} orders)' if len(fresh)>1 else '')+'.') if fresh else ''
    if fresh:
        write_store('cph_seen_notices',seen+[o['id'] for o in fresh]); toast('Your order is noted')
def order_card(o, admin=False):
    submitted=safe(o.get('createdAt','').replace('T',' ')[:16])
    status='Order noted' if o.get('noted') else 'Awaiting review'
    head=f'<div class="order-top"><div><h3>{safe(o.get("userName") if admin else o.get("service"))} <span style="color:#8290aa;font-size:11px">· {safe(o.get("id"))}</span></h3><p>'
    head+= (safe(o.get('userEmail'))+' · ' if admin else '')+'Submitted '+submitted+'</p></div><span class="status-pill '+('noted' if o.get('noted') else '')+'">'+(status if admin else ('Your order is noted' if o.get('noted') else status))+'</span></div>'
    fields=[('Service',o.get('service')),('Quantity',o.get('quantity')),('Pickup date',o.get('pickupDate')),('Pickup time',o.get('pickupTime')),('File',o.get('fileName')),('Details',o.get('details'))] if admin else [('Quantity',o.get('quantity')),('Pickup date',o.get('pickupDate')),('Pickup time',o.get('pickupTime')),('File',o.get('fileName')),('Instructions',o.get('details'))]
    details='<div class="order-details">'+''.join('<div><small>'+k+'</small><b>'+safe(v)+'</b></div>' for k,v in fields if k != 'File')+'</div>'
    file_name=o.get('fileName','')
    if o.get('fileData'):
        file_link='<a class="file-open-link" href="'+safe(o.get('fileData'))+'" target="_blank" rel="noopener" download="'+safe(file_name)+'">↗ Open / download customer file: '+safe(file_name)+'</a>'
    else:
        file_link='<p class="muted" style="font-size:11px">File: '+safe(file_name or 'No file attached')+'</p>'
    actions=(f'<label class="admin-order-actions"><input type="checkbox" data-note="{safe(o.get("id"))}" {"checked" if o.get("noted") else ""}> Mark as noted — notify this customer</label><button type="button" class="admin-delete-btn" data-delete-order="{safe(o.get("id"))}">Delete order</button>') if admin else ''
    return '<article class="order-card">'+head+details+file_link+actions+'</article>'
def render_my_orders():
    if not active_user or active_user.get('role')!='customer': return
    mine=[o for o in orders() if o.get('userEmail')==active_user['email']]
    if mine: el('#my-orders').innerHTML=''.join(order_card(o) for o in mine)
    else: el('#my-orders').innerHTML='<div class="order-card"><h3>No orders yet</h3><p class="muted">Your submitted orders and admin updates will appear here.</p><button class="btn btn-primary" data-go="order">Place your first order →</button></div>'; bind_all('#my-orders [data-go]','click',go)
def render_admin():
    if not active_user or active_user.get('role')!='admin': return
    items=orders(); el('#stat-total').textContent=str(len(items)); el('#stat-pending').textContent=str(sum(not o.get('noted') for o in items)); el('#stat-noted').textContent=str(sum(bool(o.get('noted')) for o in items))
    el('#admin-orders').innerHTML=''.join(order_card(o,True) for o in items) if items else '<div class="order-card"><h3>No customer orders yet</h3><p class="muted">Submitted orders will appear here.</p></div>'
    for cb in all_('[data-note]'):
        def change(event, checkbox=cb):
            data=orders(); target=next((o for o in data if o.get('id')==checkbox.getAttribute('data-note')),None)
            if target:
                target['noted']=bool(checkbox.checked); write_store(ORDERS_KEY,data); render_admin(); toast('Customer notified: “Your order is noted”.' if checkbox.checked else 'Order notification cleared.')
        bind(cb,'change',change)
    for btn in all_('[data-delete-order]'):
        def delete_order(event, button=btn):
            order_id=button.getAttribute('data-delete-order')
            if not window.confirm('Are you sure to delete this customer?\\n\\nThis action cannot be undone.'):
                return
            data=[o for o in orders() if o.get('id') != order_id]
            write_store(ORDERS_KEY,data)
            render_admin()
            toast('Customer order deleted.')
        bind(btn,'click',delete_order)
def refresh(event): render_admin(); toast('Order list refreshed.')

# Date validation and event wiring
el('#pickup-date').min=date.today().isoformat()
bind(el('#login-form'),'submit',login_submit); bind(el('#register-form'),'submit',register_submit); bind(el('#admin-form'),'submit',admin_submit)
bind_all('[data-auth]','click',lambda event,node:set_auth_tab(node.getAttribute('data-auth')))
def toggle_password(event, node):
    field=el('#'+node.getAttribute('data-toggle-password'))
    visible=field.type=='password'
    field.type='text' if visible else 'password'
    node.textContent='Hide' if visible else 'Show'
    node.setAttribute('aria-label','Hide password' if visible else 'Show password')
bind_all('[data-toggle-password]','click',toggle_password)
bind_all('[data-go]','click',go); bind_all('[data-back]','click',back); bind_all('[data-service]','click',choose_service)
bind(el('#logout-btn'),'click',logout); bind(el('#order-form'),'submit',order_submit); bind(el('#submit-order'),'click',submit_order); bind(el('#refresh-orders'),'click',refresh)
el('#year').textContent=str(date.today().year)
try:
    saved=read_store(SESSION_KEY,None)
    if saved and saved.get('role') in ['customer','admin']:
        active_user=saved; page('admin' if saved['role']=='admin' else 'home',False)
except Exception: pass
update_header()
