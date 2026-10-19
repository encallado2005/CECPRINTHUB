import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, onSnapshot, updateDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

/* ═══════════════════════════════════════════════════════════
   Firebase config — evd-final-project
   ═══════════════════════════════════════════════════════════ */
const cfg = {
  apiKey: "AIzaSyAIcO0x53krFklJ4GS_D5Mx-2T6H9GrZZM",
  authDomain: "evd-final-project.firebaseapp.com",
  projectId: "evd-final-project",
  storageBucket: "evd-final-project.firebasestorage.app",
  messagingSenderId: "1039460369257",
  appId: "1:1039460369257:web:c5c46038fe37ff7a94b3f8",
  measurementId: "G-JX8HM74NP2"
};
const app = initializeApp(cfg), auth = getAuth(app), db = getFirestore(app);

/* ═══════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════ */
const INITIAL_ADMIN = 'admin@gmail.com';
const MAX_FILE_KB   = 750;

const STATUSES = {
  pending:    { label: 'Pending',          customer: 'Awaiting review',    icon: '⏳' },
  processing: { label: 'Processing',       customer: 'Being prepared',     icon: '⚙️' },
  ready:      { label: 'Ready for Pickup', customer: 'Ready for pickup!',  icon: '✅' },
  completed:  { label: 'Completed',        customer: 'Completed',          icon: '📦' },
  cancelled:  { label: 'Cancelled',        customer: 'Cancelled',          icon: '✖️'  }
};

// File-accept rules per service type
const SERVICE_ACCEPT = {
  'Documents':         { accept: '.pdf,.doc,.docx,.txt',           hint: 'PDF, DOC, DOCX, TXT — max 750 KB' },
  'Photocopying':      { accept: 'image/png,image/jpeg,image/webp', hint: 'PNG, JPG, WEBP images — max 750 KB' },
  'Posters':           { accept: 'image/png,image/jpeg,image/webp', hint: 'PNG, JPG, WEBP images — max 750 KB' },
  'IDs & Forms':       { accept: '.pdf,.doc,.docx,.txt,image/png,image/jpeg', hint: 'PDF, DOC, TXT or JPG/PNG — max 750 KB' },
  'Tarpaulin / Others':{ accept: '.pdf,image/png,image/jpeg,image/webp', hint: 'PDF or image — max 750 KB' },
};
const DEFAULT_ACCEPT = { accept: '.pdf,.doc,.docx,.txt,image/png,image/jpeg,image/webp', hint: 'PDF, DOC, TXT or image — max 750 KB' };

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */
let user = null, role = null, draft = null, navHistory = [], unsub = null, ordersCache = [];
let adminFilter = 'all', adminSearch = '', adminUsers = [];
let pendingAdminLogin = false;

/* ═══════════════════════════════════════════════════════════
   DOM helpers
   ═══════════════════════════════════════════════════════════ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ═══════════════════════════════════════════════════════════
   CUSTOM MODAL — replaces window.alert & window.confirm
   ═══════════════════════════════════════════════════════════ */
function showModal({ title = 'Notice', body = '', icon = 'ℹ', type = 'info', confirm = false }) {
  return new Promise(resolve => {
    $('#modal-title').textContent = title;
    $('#modal-body').textContent  = body;
    $('#modal-icon').textContent  = icon;

    const wrap = $('#modal-icon-wrap');
    wrap.className = 'modal-icon-wrap modal-icon-' + type;

    const actions = $('#modal-actions');
    if (confirm) {
      actions.innerHTML =
        '<button class="btn btn-ghost" id="modal-cancel">Cancel</button>' +
        '<button class="btn btn-primary" id="modal-ok">Confirm</button>';
      $('#modal-cancel').onclick = () => { closeModal(); resolve(false); };
    } else {
      actions.innerHTML = '<button class="btn btn-primary" id="modal-ok">OK</button>';
    }
    $('#modal-ok').onclick = () => { closeModal(); resolve(true); };
    $('#modal-backdrop').classList.remove('hidden');
    $('#modal-ok').focus();
  });
}
function closeModal() { $('#modal-backdrop').classList.add('hidden'); }

// Shorthand helpers
const alertModal   = (body, title = 'Notice', type = 'info')  => showModal({ title, body, type });
const successModal = (body, title = 'Success')                 => showModal({ title, body, icon: '✓', type: 'success' });
const errorModal   = (body, title = 'Error')                   => showModal({ title, body, icon: '✕', type: 'error' });
const confirmModal = (body, title = 'Please confirm')          => showModal({ title, body, icon: '?', type: 'warn', confirm: true });

/* ═══════════════════════════════════════════════════════════
   Toast (transient status bar, non-blocking)
   ═══════════════════════════════════════════════════════════ */
function toast(m, type) {
  const t = $('#toast');
  t.textContent = m;
  t.className = 'toast show' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
  setTimeout(() => (t.className = 'toast'), 3500);
}

/* ═══════════════════════════════════════════════════════════
   Auth message (inline form error)
   ═══════════════════════════════════════════════════════════ */
function msg(m) { $('#auth-message').textContent = m; $('#auth-message').classList.remove('hidden'); }

function tab(t) {
  $$('[data-auth]').forEach(b => b.classList.toggle('active', b.dataset.auth === t));
  ['login', 'register', 'admin'].forEach(n => $('#' + n + '-form').classList.toggle('hidden', n !== t));
  $('#auth-message').classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════════
   Navigation
   ═══════════════════════════════════════════════════════════ */
function page(n, push = true) {
  if (!$('#' + n + '-page')) n = 'home';
  if (push) {
    const p = $$('.page').find(x => !x.classList.contains('hidden'));
    if (p && p.id !== n + '-page') navHistory.push(p.id.replace('-page', ''));
  }
  $$('.page').forEach(p => p.classList.toggle('hidden', p.id !== n + '-page'));
  window.scrollTo(0, 0);
  if (n === 'orders') renderOrders();
  if (n === 'admin')  renderAdmin();
  if (n === 'home')   renderNotice();
  if (n === 'order')  updateFileInput(); // update file accept when order page shown
  header();
}
function header() {
  document.body.classList.toggle('admin-mode', role === 'admin' && !!user);
  $('#session-label').textContent = user
    ? (role === 'admin' ? 'Admin panel' : 'Hi, ' + (user.displayName || user.email).split(' ')[0])
    : '';
  $('#logout-btn').classList.toggle('hidden', !user);
}
function back() { page(navHistory.pop() || (role === 'admin' ? 'admin' : user ? 'home' : 'auth'), false); }

/* ═══════════════════════════════════════════════════════════
   Dynamic file input — updates accept & hint per service
   ═══════════════════════════════════════════════════════════ */
function updateFileInput() {
  const service = $('#service-type')?.value || '';
  const rule = SERVICE_ACCEPT[service] || DEFAULT_ACCEPT;
  const fi = $('#order-file');
  const fh = $('#file-hint');
  if (fi) fi.accept = rule.accept;
  if (fh) fh.textContent = '(' + rule.hint + ')';
}

/* ═══════════════════════════════════════════════════════════
   Admin detection (Firestore admins collection)
   ═══════════════════════════════════════════════════════════ */
async function checkAdmin(u) {
  if (!u) return false;
  const email = (u.email || '').toLowerCase();
  if (email === INITIAL_ADMIN) {
    // Bootstrap primary admin document silently — never throws to the UI
    try {
      const ref  = doc(db, 'admins', email);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, { email, displayName: u.displayName || 'Administrator', uid: u.uid, addedBy: 'system', createdAt: serverTimestamp() });
      }
    } catch (e) { console.warn('Admin bootstrap (non-fatal):', e.message); }
    return true;
  }
  try { return (await getDoc(doc(db, 'admins', email))).exists(); } catch { return false; }
}

/* ═══════════════════════════════════════════════════════════
   Admin management
   ═══════════════════════════════════════════════════════════ */
async function loadAdmins() {
  try {
    const s = await getDocs(collection(db, 'admins'));
    adminUsers = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAdminList();
  } catch (e) { console.warn('loadAdmins (non-fatal):', e.message); }
}
async function addAdmin(email) {
  email = email.trim().toLowerCase();
  if (!email || !email.includes('@')) return errorModal('Please enter a valid email address.');
  if (adminUsers.some(a => a.email === email)) return alertModal('That email is already an admin.', 'Already Added');
  try {
    await setDoc(doc(db, 'admins', email), { email, displayName: email.split('@')[0], addedBy: user.email, createdAt: serverTimestamp() });
    toast(email + ' added as admin.', 'success');
    loadAdmins();
  } catch (e) { errorModal(e.message); }
}
async function removeAdmin(email) {
  if (email === INITIAL_ADMIN) return alertModal('The primary admin account cannot be removed.', 'Not Allowed');
  if (email === (user.email || '').toLowerCase()) return alertModal('You cannot remove your own admin access.', 'Not Allowed');
  const ok = await confirmModal('Remove ' + email + ' from admin access? They will no longer be able to manage orders.');
  if (!ok) return;
  try { await deleteDoc(doc(db, 'admins', email)); toast(email + ' removed.', 'success'); loadAdmins(); }
  catch (e) { errorModal(e.message); }
}
function renderAdminList() {
  const el = $('#admin-list'); if (!el) return;
  el.innerHTML = adminUsers.length
    ? adminUsers.map(a =>
        `<div class="admin-account-item">` +
        `<div><b>${esc(a.displayName || a.email)}</b><small>${esc(a.email)}</small></div>` +
        (a.email === INITIAL_ADMIN
          ? `<span class="admin-badge">Primary</span>`
          : `<button class="btn btn-ghost btn-sm" data-remove-admin="${esc(a.email)}">Remove</button>`) +
        `</div>`
      ).join('')
    : '<p class="muted">No admin accounts found.</p>';
  $$('[data-remove-admin]').forEach(b => b.onclick = () => removeAdmin(b.dataset.removeAdmin));
}

/* ═══════════════════════════════════════════════════════════
   File utilities
   ═══════════════════════════════════════════════════════════ */
function fileToBase64(file) {
  return new Promise((res, rej) => {
    if (file.size > MAX_FILE_KB * 1024)
      return rej(new Error(`File is too large (${(file.size / 1024).toFixed(0)} KB). Maximum allowed is ${MAX_FILE_KB} KB.`));
    const r = new FileReader();
    r.onload  = () => res(String(r.result));
    r.onerror = () => rej(new Error('Could not read the file. Please try again.'));
    r.readAsDataURL(file);
  });
}
function compressImage(dataUrl, maxW = 1024, q = 0.65) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}
function openBase64File(dataUrl, fileName) {
  try {
    const m = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!m) { window.open(dataUrl, '_blank'); return; }
    const raw = atob(m[2]), arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: m[1] }));
    const a   = document.createElement('a');
    a.href = url; a.download = fileName || 'file'; a.target = '_blank';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1200);
  } catch { window.open(dataUrl, '_blank'); }
}

/* ═══════════════════════════════════════════════════════════
   Order status helper (backward-compat with old `noted` bool)
   ═══════════════════════════════════════════════════════════ */
function getStatus(o) {
  return (o.status && STATUSES[o.status]) ? o.status : (o.noted ? 'processing' : 'pending');
}

/* ═══════════════════════════════════════════════════════════
   Order card renderer
   ═══════════════════════════════════════════════════════════ */
function card(o, admin = false) {
  const st   = getStatus(o);
  const si   = STATUSES[st] || STATUSES.pending;
  const stamp = o.createdAt?.toDate
    ? o.createdAt.toDate().toLocaleString()
    : String(o.createdAt || '').replace('T', ' ').slice(0, 16);

  let h = `<article class="order-card">` +
    `<div class="order-top"><div>` +
    `<h3>${esc(admin ? o.userName : o.service)} <span style="color:#8290aa;font-size:11px">· ${esc(o.id)}</span></h3>` +
    `<p>${admin ? esc(o.userEmail) + ' · ' : ''}Submitted ${esc(stamp)}</p>` +
    `</div><span class="status-pill status-${st}">${si.icon} ${admin ? si.label : si.customer}</span></div>`;

  const fields = admin
    ? [['Service', o.service], ['Quantity', o.quantity], ['Pickup date', o.pickupDate], ['Pickup time', o.pickupTime], ['Details', o.details]]
    : [['Quantity', o.quantity], ['Pickup date', o.pickupDate], ['Pickup time', o.pickupTime], ['Instructions', o.details]];
  h += `<div class="order-details">${fields.map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>`;

  if (o.price) h += `<div class="order-price-display">Price: <b>₱${esc(String(o.price))}</b></div>`;
  if (!admin && o.adminNotes) h += `<div class="admin-note-bubble"><small>Note from admin</small><p>${esc(o.adminNotes)}</p></div>`;

  h += `<p class="muted" style="font-size:12px">File: ${esc(o.fileName || 'No file attached')}</p>`;
  h += `<button class="btn btn-ghost" data-file="${esc(o.id)}">↗ Open / download file</button>`;

  if (admin) {
    h += `<div class="admin-order-actions">` +
      `<div class="admin-action-row">` +
      `<label class="admin-action-label">Status` +
      `<select class="admin-status-select" data-status-order="${esc(o.id)}">` +
      Object.entries(STATUSES).map(([k, v]) => `<option value="${k}"${st === k ? ' selected' : ''}>${v.label}</option>`).join('') +
      `</select></label>` +
      `<label class="admin-action-label">Price (₱)<input type="number" class="admin-price-input" data-price-order="${esc(o.id)}" value="${o.price || ''}" placeholder="0.00" min="0" step="0.50"></label>` +
      `</div>` +
      `<label class="admin-action-label wide">Admin notes<textarea class="admin-notes-input" data-notes-order="${esc(o.id)}" rows="2" placeholder="Add a note for the customer…">${esc(o.adminNotes || '')}</textarea></label>` +
      `<div class="admin-action-buttons">` +
      `<button class="btn btn-primary btn-sm" data-save-order="${esc(o.id)}">💾 Save changes</button>` +
      `<button class="admin-delete-btn" data-delete-order="${esc(o.id)}">Delete order</button>` +
      `</div></div>`;
  }
  return h + '</article>';
}

/* ═══════════════════════════════════════════════════════════
   Bind interactive elements inside order cards
   ═══════════════════════════════════════════════════════════ */
function bindCards() {
  // Open / download
  $$('[data-file]').forEach(b => b.onclick = async () => {
    const o = ordersCache.find(x => x.id === b.dataset.file);
    if (!o) return errorModal('Order not found.');
    try {
      if (o.fileData) return openBase64File(o.fileData, o.fileName);
      const snap = await getDoc(doc(db, 'orders', o.id));
      if (!snap.exists()) return errorModal('Order document not found in database.');
      const d = snap.data();
      d.fileData ? openBase64File(d.fileData, d.fileName || o.fileName) : errorModal('No file is stored for this order.');
    } catch (e) { errorModal(e.message); }
  });

  // Save order (admin)
  $$('[data-save-order]').forEach(b => b.onclick = async () => {
    const id      = b.dataset.saveOrder;
    const status  = $(`[data-status-order="${id}"]`)?.value || 'pending';
    const price   = $(`[data-price-order="${id}"]`)?.value;
    const notes   = $(`[data-notes-order="${id}"]`)?.value?.trim() || '';
    b.disabled = true; b.textContent = 'Saving…';
    try {
      await updateDoc(doc(db, 'orders', id), {
        status,
        noted: ['processing', 'ready', 'completed'].includes(status),
        price: price ? Number(price) : null,
        adminNotes: notes,
        updatedAt: serverTimestamp()
      });
      toast('Order updated.', 'success');
    } catch (e) { errorModal(e.message); }
    finally { b.disabled = false; b.textContent = '💾 Save changes'; }
  });

  // Delete order (admin)
  $$('[data-delete-order]').forEach(b => b.onclick = async () => {
    const ok = await confirmModal('Delete this order permanently? This action cannot be undone.', 'Delete Order');
    if (!ok) return;
    try { await deleteDoc(doc(db, 'orders', b.dataset.deleteOrder)); toast('Order deleted.', 'success'); }
    catch (e) { errorModal(e.message); }
  });
}

/* ═══════════════════════════════════════════════════════════
   Render functions
   ═══════════════════════════════════════════════════════════ */
function renderAdmin() {
  if (role !== 'admin') return;
  const all = ordersCache;
  $('#stat-total').textContent     = all.length;
  $('#stat-pending').textContent   = all.filter(x => getStatus(x) === 'pending').length;
  const pe = $('#stat-processing'); if (pe) pe.textContent = all.filter(x => getStatus(x) === 'processing').length;
  const re = $('#stat-ready');      if (re) re.textContent = all.filter(x => getStatus(x) === 'ready').length;
  const ce = $('#stat-completed');  if (ce) ce.textContent = all.filter(x => getStatus(x) === 'completed').length;

  let list = all;
  if (adminFilter !== 'all') list = list.filter(o => getStatus(o) === adminFilter);
  if (adminSearch) {
    const s = adminSearch.toLowerCase();
    list = list.filter(o => [o.userName, o.userEmail, o.id, o.service].some(v => (v || '').toLowerCase().includes(s)));
  }

  $('#admin-orders').innerHTML = list.length
    ? list.map(o => card(o, true)).join('')
    : '<div class="order-card"><h3>No orders found</h3><p class="muted">No orders match your current filter.</p></div>';
  bindCards();
  loadAdmins();
}
function renderOrders() {
  if (!user || role !== 'customer') return;
  const a = ordersCache.filter(o => o.uid === user.uid);
  $('#my-orders').innerHTML = a.length
    ? a.map(o => card(o)).join('')
    : '<div class="order-card"><h3>No orders yet</h3><p class="muted">Your submitted orders will appear here.</p><button class="btn btn-primary" data-go="order">Place your first order →</button></div>';
  bindCards();
  $$('#my-orders [data-go]').forEach(b => b.onclick = () => page('order'));
}
function renderNotice() {
  const el = $('#customer-notice'); if (!el || !user) return;
  const ready = ordersCache.filter(o => o.uid === user.uid && getStatus(o) === 'ready');
  const proc  = ordersCache.filter(o => o.uid === user.uid && getStatus(o) === 'processing');
  el.innerHTML = ready.length
    ? `🎉 ${ready.length} order${ready.length > 1 ? 's are' : ' is'} ready for pickup!`
    : proc.length
    ? `⚙️ Your order${proc.length > 1 ? 's are' : ' is'} being prepared.`
    : '';
}

/* ═══════════════════════════════════════════════════════════
   Real-time listener
   ─ FIX 1: Sync error is caused by the onSnapshot query running
     BEFORE Firestore rules are published, or when reading the
     orders collection while not yet an authenticated user.
     We now wrap in try/catch and show a non-blocking console
     warning instead of a noisy toast. Rules must be deployed.
   ═══════════════════════════════════════════════════════════ */
function watchOrders() {
  if (unsub) { unsub(); unsub = null; }
  if (!user) return;
  const q = role === 'admin'
    ? query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'orders'), where('uid', '==', user.uid));
  unsub = onSnapshot(q,
    snap => {
      ordersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!$('#admin-page').classList.contains('hidden'))  renderAdmin();
      if (!$('#orders-page').classList.contains('hidden')) renderOrders();
      renderNotice();
    },
    err => {
      // Only log — do NOT show a popup. Permissions are fixed via Firestore Rules deployment.
      console.warn('Orders listener error (check Firestore Rules):', err.code, err.message);
    }
  );
}

/* ═══════════════════════════════════════════════════════════
   Auth handlers
   ═══════════════════════════════════════════════════════════ */
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  try { await signInWithEmailAndPassword(auth, $('#login-email').value.trim(), $('#login-password').value); }
  catch (x) { msg(x.message); }
});

$('#register-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const c = await createUserWithEmailAndPassword(auth, $('#reg-email').value.trim(), $('#reg-password').value);
    await updateProfile(c.user, { displayName: $('#reg-name').value.trim() });
    // Silently create user document — no UI error if it fails (rules will allow it once logged in)
    try {
      await setDoc(doc(db, 'users', c.user.uid), {
        uid: c.user.uid,
        displayName: c.user.displayName,
        email: c.user.email,
        createdAt: serverTimestamp()
      });
    } catch (e) { console.warn('User doc create (non-fatal):', e.message); }
  } catch (x) { msg(x.message); }
});

$('#admin-form').addEventListener('submit', async e => {
  e.preventDefault();
  pendingAdminLogin = true;
  try { await signInWithEmailAndPassword(auth, $('#admin-email').value.trim(), $('#admin-password').value); }
  catch (x) { pendingAdminLogin = false; msg(x.message); }
});

/* ═══════════════════════════════════════════════════════════
   Order form — FIX 2: per-service file type restriction
   ═══════════════════════════════════════════════════════════ */
$('#service-type').addEventListener('change', updateFileInput);

$('#order-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = $('#order-file').files[0];
  if (!f) return errorModal('Please attach a file before continuing.', 'File Required');

  // Validate file type matches selected service
  const service  = $('#service-type').value;
  const rule     = SERVICE_ACCEPT[service] || DEFAULT_ACCEPT;
  const isImage  = /^image\//i.test(f.type);
  const isDoc    = /\.(pdf|doc|docx|txt)$/i.test(f.name);

  // Re-validate on submit in case user bypassed the accept attribute
  if ((service === 'Documents' || service === 'IDs & Forms') && !isDoc && !isImage) {
    return errorModal('Please upload a document file (PDF, DOC, DOCX, or TXT) for the selected service.', 'Invalid File Type');
  }
  if ((service === 'Photocopying' || service === 'Posters') && !isImage) {
    return errorModal('Please upload an image (PNG, JPG, or WEBP) for the selected service.', 'Invalid File Type');
  }

  try {
    let b64 = await fileToBase64(f);
    // Compress images to stay within Firestore 1MB document limit
    if (isImage) b64 = await compressImage(b64, 1024, 0.65);

    draft = {
      service, quantity: Number($('#quantity').value),
      details: $('#details').value.trim(),
      fileName: f.name, fileType: f.type || 'application/octet-stream',
      fileData: b64,
      pickupDate: $('#pickup-date').value, pickupTime: $('#pickup-time').value
    };

    $('#order-summary').innerHTML = [
      ['Service', draft.service], ['Quantity', draft.quantity],
      ['Print details', draft.details], ['File', draft.fileName],
      ['Pickup date', draft.pickupDate], ['Pickup time', draft.pickupTime],
      ['Collection', 'In-store pickup only — no delivery']
    ].map(([k, v]) => `<div class="summary-item"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('');

    page('checkout');
  } catch (err) { errorModal(err.message, 'File Error'); }
});

/* ═══════════════════════════════════════════════════════════
   Submit order → Firestore
   FIX 3: uid is always included; rules allow create if uid matches
   ═══════════════════════════════════════════════════════════ */
$('#submit-order').onclick = async () => {
  if (!draft || !user) return;
  const btn = $('#submit-order');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const id = 'CPH-' + Date.now().toString(36).toUpperCase();
    await setDoc(doc(db, 'orders', id), {
      id,
      uid:       user.uid,          // ← always attached for Firestore rules
      userEmail: user.email,
      userName:  user.displayName || user.email.split('@')[0],
      service:   draft.service,
      quantity:  draft.quantity,
      details:   draft.details,
      fileName:  draft.fileName,
      fileType:  draft.fileType,
      fileData:  draft.fileData,
      pickupDate: draft.pickupDate,
      pickupTime: draft.pickupTime,
      status:     'pending',
      noted:      false,
      adminNotes: '',
      price:      null,
      createdAt:  serverTimestamp()
    });
    draft = null;
    $('#order-form').reset();
    updateFileInput();
    await successModal('Your order has been submitted! We\'ll have it ready for pickup.', 'Order Submitted!');
    page('orders', false);
  } catch (e) {
    const msg2 = e.message.includes('longer than') || e.message.includes('exceeds') || e.message.includes('Maximum')
      ? 'File is too large for storage. Please use a file smaller than 750 KB.'
      : e.message.includes('permission') || e.message.includes('insufficient')
      ? 'Permission denied. Please make sure the Firestore rules are deployed in your Firebase Console.'
      : e.message;
    errorModal(msg2, 'Submission Failed');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Submit order <span>→</span>';
  }
};

/* ═══════════════════════════════════════════════════════════
   Logout
   FIX 4: uses custom modal instead of window.confirm
   ═══════════════════════════════════════════════════════════ */
$('#logout-btn').onclick = async () => {
  const ok = await confirmModal('Are you sure you want to log out?', 'Log Out');
  if (!ok) return;
  try {
    await signOut(auth);
    // onAuthStateChanged will handle the redirect to auth page automatically
    toast('You have logged out. See you soon!');
  } catch (e) {
    errorModal('Could not log out. Please try again.', 'Logout Error');
  }
};

$('#refresh-orders').onclick = () => { watchOrders(); toast('Order list refreshed.'); };

/* ═══════════════════════════════════════════════════════════
   UI wiring
   ═══════════════════════════════════════════════════════════ */
$$('[data-auth]').forEach(b => b.onclick = () => tab(b.dataset.auth));

$$('[data-toggle-password]').forEach(b => b.onclick = () => {
  const f = $('#' + b.dataset.togglePassword);
  f.type = f.type === 'password' ? 'text' : 'password';
  b.textContent = f.type === 'password' ? 'Show' : 'Hide';
});

$$('[data-go]').forEach(b => b.onclick = e => {
  e.preventDefault();
  const n = b.dataset.go;
  if (n === 'home' && !user)                                     { page('auth', false); return; }
  if (['order', 'checkout', 'orders'].includes(n) && !user)      { page('auth'); msg('Please log in or create an account to continue.'); return; }
  if (n === 'order' && b.dataset.service) $('#service-type').value = b.dataset.service;
  page(n);
});

$$('[data-service]').forEach(b => b.onclick = () => {
  if (!user || role !== 'customer') { page('auth'); return; }
  $('#service-type').value = b.dataset.service;
  updateFileInput();
  page('order');
});

$$('[data-back]').forEach(b => b.onclick = back);

// Admin filter bar
$$('[data-filter]').forEach(b => b.onclick = () => {
  adminFilter = b.dataset.filter;
  $$('[data-filter]').forEach(x => x.classList.toggle('active', x.dataset.filter === adminFilter));
  renderAdmin();
});

// Admin search
const _si = $('#admin-search');
if (_si) _si.addEventListener('input', e => { adminSearch = e.target.value.trim(); renderAdmin(); });

// Admin add button
const _ab = $('#add-admin-btn');
if (_ab) _ab.onclick = () => {
  const i = $('#new-admin-email');
  if (i?.value.trim()) { addAdmin(i.value); i.value = ''; }
  else errorModal('Please enter an email address before clicking Add Admin.', 'Email Required');
};

// Dismiss modal on backdrop click
$('#modal-backdrop').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
// Dismiss modal on Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

$('#pickup-date').min  = new Date().toISOString().slice(0, 10);
$('#year').textContent = new Date().getFullYear();

/* ═══════════════════════════════════════════════════════════
   Auth state observer
   FIX 1: profile sync errors are silenced (non-fatal console warn)
   FIX 3: admin check runs before watchOrders so correct query is used
   ═══════════════════════════════════════════════════════════ */
onAuthStateChanged(auth, async u => {
  user = u;

  if (!u) {
    role = null;
    draft = null;
    navHistory = [];
    if (unsub) { unsub(); unsub = null; }
    ordersCache = [];
    header();
    if (!$('#auth-page').classList.contains('hidden')) return;
    page('auth', false);
    return;
  }

  // Determine role first — critical for correct Firestore queries
  const isAdm = await checkAdmin(u);
  role = isAdm ? 'admin' : 'customer';

  // Reject non-admin who clicked the Admin login tab
  if (pendingAdminLogin && !isAdm) {
    pendingAdminLogin = false;
    await signOut(auth);
    msg('This account does not have admin access. Please use a customer account to log in.');
    return;
  }
  pendingAdminLogin = false;

  header();

  // FIX 1: Profile sync wrapped in try/catch — never throws to the UI
  try {
    const ud = await getDoc(doc(db, 'users', u.uid));
    if (ud.exists() && ud.data().displayName && !u.displayName) {
      await updateProfile(u, { displayName: ud.data().displayName });
    }
    if (!ud.exists() && role === 'customer') {
      await setDoc(doc(db, 'users', u.uid), {
        uid: u.uid,
        displayName: u.displayName || u.email.split('@')[0],
        email: u.email,
        createdAt: serverTimestamp()
      });
    }
  } catch (e) {
    // Non-fatal — rules may not be deployed yet. Never show "Sync error" to the user.
    console.warn('Profile sync skipped (check Firestore Rules are deployed):', e.code, e.message);
  }

  // Start real-time listener after role is set
  watchOrders();
  page(role === 'admin' ? 'admin' : 'home', false);
  toast(role === 'admin' ? 'Welcome, admin.' : 'Welcome to CECPRINTHUB!', 'success');
});
