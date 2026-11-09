/* ═══════════════════════════════════════════════════════
   UniCampus Admin Portal — app.js
   All frontend logic, API calls, page rendering
═══════════════════════════════════════════════════════ */

const API = '/api/admin';
let currentPage = 'overview';
let charts = {};

// ─── UTILS ─────────────────────────────────────────────────────
const fmt = n => '₹ ' + Number(n).toLocaleString('en-IN', {maximumFractionDigits:0});
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const fmtNum = n => Number(n).toLocaleString('en-IN');

function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' '+type : '');
  setTimeout(() => { t.classList.remove('show'); }, 3000);
}

function apiFetch(url, opts={}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  return fetch(url, { credentials: 'same-origin', ...opts, headers })
    .then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Request failed');
      return data;
    });
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

// ─── AUTH ───────────────────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  err.classList.remove('show');
  if (!email || !password) { err.textContent='Enter credentials'; err.classList.add('show'); return; }
  btn.textContent = 'Signing in…'; btn.disabled = true;
  try {
    const data = await apiFetch(`${API}/login`, {
      method:'POST', body: JSON.stringify({ email, password })
    });
    initApp(data.email);
  } catch(e) {
    err.textContent = e.message; err.classList.add('show');
  } finally { btn.textContent='Sign In'; btn.disabled=false; }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') doLogin();
});

async function doLogout() {
  try { await apiFetch(`${API}/logout`, { method:'POST' }); } catch {}
  document.getElementById('app').classList.remove('active');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

// ─── PROFILE MODAL ──────────────────────────────────────────────
function openProfileModal() {
  document.getElementById('profile-modal').classList.add('open');
  document.getElementById('admin-dropdown').classList.remove('open');
  document.getElementById('profile-error').classList.remove('show');
  ['p-current','p-email','p-new'].forEach(id => document.getElementById(id).value='');
}
function closeProfileModal() { document.getElementById('profile-modal').classList.remove('open'); }
async function saveProfile() {
  const cur = document.getElementById('p-current').value;
  const email = document.getElementById('p-email').value.trim();
  const np = document.getElementById('p-new').value;
  const errEl = document.getElementById('profile-error');
  if (!cur) { errEl.textContent='Current password required'; errEl.classList.add('show'); return; }
  if (!email && !np) { errEl.textContent='Enter new email or new password'; errEl.classList.add('show'); return; }
  try {
    const data = await apiFetch(`${API}/profile`, { method:'PUT', body: JSON.stringify({ email:email||undefined, current_password:cur, new_password:np||undefined }) });
    updateAdminDisplay(data.email);
    closeProfileModal(); showToast('Profile updated', 'success');
  } catch(e) { errEl.textContent = e.message; errEl.classList.add('show'); }
}

function toggleProfileDropdown() {
  document.getElementById('admin-dropdown').classList.toggle('open');
}
document.addEventListener('click', e => {
  if (!document.getElementById('admin-profile-btn').contains(e.target))
    document.getElementById('admin-dropdown').classList.remove('open');
});

function updateAdminDisplay(email) {
  document.getElementById('admin-email-display').textContent = email;
  document.getElementById('dropdown-email').textContent = email;
  document.getElementById('admin-avatar').textContent = email.charAt(0).toUpperCase();
}

// ─── INIT APP ───────────────────────────────────────────────────
async function initApp(email) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('app').classList.add('active');
  document.getElementById('today-date').textContent = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  updateAdminDisplay(email || 'Admin');
  navigate('overview');
}

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.page-content').forEach(el => el.classList.toggle('active', el.id === 'page-'+page));
  const titles = { overview:'Overview', orders:'Orders', revenue:'Revenue', profit:'Profit', discount:'Discount Codes', support:'Customer Support', products:'Products' };
  const subs   = { overview:'Welcome back, Admin! Here\'s what\'s happening.', orders:'Manage and track all orders', revenue:'Revenue analytics and trends', profit:'Profit breakdown and analysis', discount:'Manage discount codes', support:'Customer requests and messages', products:'Add, edit and manage your product catalogue' };
  document.getElementById('page-title').textContent = titles[page];
  document.getElementById('page-sub').textContent = subs[page];
  const renderers = { overview:renderOverview, orders:renderOrders, revenue:renderRevenue, profit:renderProfit, discount:renderDiscount, support:renderSupport, products:renderProducts };
  if (renderers[page]) renderers[page]();
}

// ─── STATUS BADGE ───────────────────────────────────────────────
function statusBadge(s) {
  const map = { Completed:'completed', Processing:'processing', Pending:'pending', Cancelled:'cancelled', Open:'open', 'In Progress':'in-progress', Resolved:'resolved' };
  return `<span class="badge badge-${map[s]||'pending'}">${s}</span>`;
}

// ─── PAGE: OVERVIEW ─────────────────────────────────────────────
async function renderOverview() {
  const el = document.getElementById('page-overview');
  el.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><p>Loading overview…</p></div>`;
  try {
    const d = await apiFetch(`${API}/overview`);
    el.innerHTML = `
      <div class="stats-grid">
        ${statCard('💰','Total Revenue',fmt(d.totalRevenue),'--blue','up','Live')}
        ${statCard('📈','Total Profit',fmt(d.totalProfit),'--green','up','Live')}
        ${statCard('🛍️','Total Orders',fmtNum(d.totalOrders),'--purple','up','Live')}
        ${statCard('✅','Orders Done',fmtNum(d.ordersDone),'--blue','up','')}
        ${statCard('⏳','Orders Pending',fmtNum(d.ordersPending),'--orange','neutral','')}
        ${statCard('🔄','Repeated Clients',fmtNum(d.repeatedClients),'--purple','neutral','')}
        ${statCard('🎁','Discounts Given',fmt(d.discountsUsed),'--yellow','neutral','')}
        ${statCard('❌','Cancelled',fmtNum(d.ordersCancelled),'--red','neutral','')}
      </div>

      <div class="panels-row" style="grid-template-columns:2fr 1fr">
        <div class="panel">
          <div class="panel-head">
            <span class="panel-title">Revenue Overview</span>
            <select class="filter-select" id="ov-period" onchange="updateOverviewChart()" style="padding:5px 10px;font-size:12px;">
              <option value="daily">Daily (30d)</option>
              <option value="monthly" selected>Monthly</option>
            </select>
          </div>
          <div class="panel-body">
            <div style="font-size:12px;color:var(--text-3);margin-bottom:4px;">Total Revenue</div>
            <div style="font-size:26px;font-weight:800;letter-spacing:-.8px;margin-bottom:16px;">${fmt(d.totalRevenue)}</div>
            <div class="chart-wrap"><canvas id="ov-chart"></canvas></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><span class="panel-title">Order Status</span></div>
          <div class="panel-body">
            <div style="display:flex;flex-direction:column;align-items:center;gap:20px;">
              <div class="donut-wrap"><canvas id="donut-chart"></canvas></div>
              <div class="status-legend">
                ${legendRow('#22c55e','Completed',d.ordersDone,d.totalOrders)}
                ${legendRow('#4f7cf6','Processing',d.ordersProcessing,d.totalOrders)}
                ${legendRow('#f97316','Pending',d.ordersPending,d.totalOrders)}
                ${legendRow('#ef4444','Cancelled',d.ordersCancelled,d.totalOrders)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">Recent Orders</span>
          <a onclick="navigate('orders')" style="font-size:13px;color:var(--blue);cursor:pointer;font-weight:600;">View All Orders →</a>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ORDER ID</th><th>CUSTOMER</th><th>AMOUNT</th><th>STATUS</th><th>DATE</th></tr></thead>
            <tbody>
              ${d.recentOrders.map(o=>`<tr>
                <td><span style="font-family:monospace;font-weight:600;font-size:12px;">#${o.id}</span></td>
                <td>${o.customer_name}</td>
                <td style="font-weight:700;">${fmt(o.amount)}</td>
                <td>${statusBadge(o.status)}</td>
                <td style="color:var(--text-3);">${fmtDate(o.created_at)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Store data for chart re-render
    window._ovData = d;

    // Revenue chart
    buildOvChart(d.monthlyRevenue, 'monthly');

    // Donut chart
    destroyChart('donut');
    const ctx2 = document.getElementById('donut-chart').getContext('2d');
    charts['donut'] = new Chart(ctx2, {
      type:'doughnut',
      data:{ labels:['Completed','Processing','Pending','Cancelled'],
             datasets:[{data:[d.ordersDone,d.ordersProcessing,d.ordersPending,d.ordersCancelled],
                        backgroundColor:['#22c55e','#4f7cf6','#f97316','#ef4444'],
                        borderWidth:0,hoverOffset:6}]},
      options:{ cutout:'72%', plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>` ${c.label}: ${c.parsed}`}} }, animation:{animateRotate:true} }
    });
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h3>Failed to load</h3><p>${e.message}</p></div>`;
  }
}

function statCard(icon, label, value, colorVar, trend, extra) {
  const bg = { '--blue':'#eef2ff','--green':'#dcfce7','--purple':'#faf5ff','--orange':'#fff7ed','--yellow':'#fefce8','--red':'#fef2f2' };
  const bgc = bg[colorVar] || '#f3f4f6';
  const col = `var(${colorVar})`;
  return `<div class="stat-card">
    <div class="stat-card-header">
      <div>
        <div class="stat-label">${label.toUpperCase()}</div>
        <div class="stat-value">${value}</div>
        ${extra ? `<span class="stat-badge ${trend}">${extra==='Live'?'↑ Live':extra}</span>` : ''}
      </div>
      <div class="stat-icon" style="background:${bgc};"><span style="color:${col};font-size:20px;">${icon}</span></div>
    </div>
  </div>`;
}

function legendRow(color, label, count, total) {
  const pct = total ? Math.round(count/total*100) : 0;
  return `<div class="legend-row"><div><span class="legend-dot" style="background:${color}"></span>${label}</div><div><strong>${count}</strong> <span class="legend-pct">(${pct}%)</span></div></div>`;
}

function buildOvChart(data, period) {
  destroyChart('ov');
  const ctx = document.getElementById('ov-chart');
  if (!ctx) return;
  charts['ov'] = new Chart(ctx.getContext('2d'), {
    type:'line',
    data:{
      labels: data.map(r=>r.label||r.month||r.day),
      datasets:[{
        label:'Revenue',
        data: data.map(r=>r.revenue),
        borderColor:'#4f7cf6', backgroundColor:'rgba(79,124,246,.08)',
        borderWidth:2.5, pointRadius:3, pointBackgroundColor:'#4f7cf6',
        fill:true, tension:.35
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>'  '+fmt(c.parsed.y)}} },
      scales:{
        x:{ grid:{display:false}, ticks:{font:{size:11},color:'#9ca3af'} },
        y:{ grid:{color:'#f3f4f6'}, ticks:{font:{size:11},color:'#9ca3af', callback:v=>'₹'+Math.round(v/1000)+'K'} }
      }
    }
  });
}

async function updateOverviewChart() {
  const period = document.getElementById('ov-period').value;
  const d = window._ovData;
  if (!d) return;
  if (period === 'daily') buildOvChart(d.dailyRevenue, 'daily');
  else buildOvChart(d.monthlyRevenue, 'monthly');
}

// ─── PAGE: ORDERS ───────────────────────────────────────────────
let ordersState = { page:1, search:'', status:'', from:'', to:'' };

async function renderOrders() {
  const el = document.getElementById('page-orders');
  el.innerHTML = `
    <div class="section-header">
      <h2>All Orders</h2>
      <button class="btn btn-blue" onclick="openOrderModal()">+ New Order</button>
    </div>
    <div class="panel">
      <div class="panel-body" style="padding-bottom:0;">
        <div class="toolbar">
          <div class="search-input">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Search by name, email, order ID…" id="ord-search" oninput="debouncedOrderSearch()" value="${ordersState.search}">
          </div>
          <select class="filter-select" id="ord-status" onchange="ordersState.status=this.value;ordersState.page=1;loadOrders()">
            <option value="">All Statuses</option>
            <option value="Completed">Completed</option>
            <option value="Processing">Processing</option>
            <option value="Pending">Pending</option>
            <option value="Cancelled">Cancelled</option>
          </select>
          <input type="date" class="date-input" id="ord-from" onchange="ordersState.from=this.value;ordersState.page=1;loadOrders()" title="From date">
          <input type="date" class="date-input" id="ord-to" onchange="ordersState.to=this.value;ordersState.page=1;loadOrders()" title="To date">
          <button class="btn btn-outline" onclick="resetOrderFilters()">Reset</button>
        </div>
      </div>
      <div id="orders-table-wrap" class="table-wrap">
        <table>
          <thead><tr><th>ORDER ID</th><th>CUSTOMER</th><th>AMOUNT</th><th>STATUS</th><th>DATE</th><th>ACTIONS</th></tr></thead>
          <tbody id="orders-tbody"><tr class="loading-row"><td colspan="6">Loading orders…</td></tr></tbody>
        </table>
      </div>
      <div class="panel-body" style="padding-top:0;" id="orders-pagination"></div>
    </div>
    ${ordersModal()}
    ${orderViewModal()}
  `;
  document.getElementById('ord-status').value = ordersState.status;
  document.getElementById('ord-from').value = ordersState.from;
  document.getElementById('ord-to').value = ordersState.to;
  loadOrders();
}

const debouncedOrderSearch = debounce(() => {
  ordersState.search = document.getElementById('ord-search')?.value || '';
  ordersState.page = 1;
  loadOrders();
}, 350);

function resetOrderFilters() {
  ordersState = { page:1, search:'', status:'', from:'', to:'' };
  renderOrders();
}

async function loadOrders() {
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr class="loading-row"><td colspan="6">Loading…</td></tr>`;
  const { page, search, status, from, to } = ordersState;
  const q = new URLSearchParams({ page, limit:15, ...(search&&{search}), ...(status&&{status}), ...(from&&{from}), ...(to&&{to}) });
  try {
    const { orders, total, limit } = await apiFetch(`${API}/orders?${q}`);
    if (!orders.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon">📦</div><h3>No orders found</h3><p>Try adjusting your filters</p></div></td></tr>`;
      document.getElementById('orders-pagination').innerHTML=''; return;
    }
    tbody.innerHTML = orders.map(o=>`<tr>
      <td><span style="font-family:monospace;font-weight:600;font-size:12px;color:var(--blue);">#${o.id}</span></td>
      <td>
        <div style="font-weight:600;font-size:13px;">${o.customer_name}</div>
        <div style="font-size:11.5px;color:var(--text-3);">${o.customer_email}</div>
      </td>
      <td style="font-weight:700;">${fmt(o.amount)}</td>
      <td>
        <select onchange="updateOrderStatus('${o.id}',this.value)" style="border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;" class="badge-sel">
          ${['Pending','Processing','Completed','Cancelled'].map(s=>`<option${s===o.status?' selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td style="color:var(--text-3);font-size:12px;">${fmtDate(o.created_at)}</td>
      <td>
        <div style="display:flex;gap:4px;">
          <span class="icon-action" title="View" onclick="viewOrder('${o.id}')">👁️</span>
          <span class="icon-action del" title="Delete" onclick="deleteOrder('${o.id}')">🗑️</span>
        </div>
      </td>
    </tr>`).join('');
    // Pagination
    const pages = Math.ceil(total / limit);
    const pg = document.getElementById('orders-pagination');
    if (pages > 1) {
      pg.innerHTML = `<div class="pagination">
        <span class="pagination-info">Showing ${(page-1)*limit+1}–${Math.min(page*limit,total)} of ${total} orders</span>
        <div class="pagination-btns">
          <button class="page-btn" onclick="ordersState.page=${page-1};loadOrders()" ${page<=1?'disabled':''}>‹ Prev</button>
          ${Array.from({length:Math.min(pages,5)},(_,i)=>{const p=i+1;return`<button class="page-btn${p===page?' active':''}" onclick="ordersState.page=${p};loadOrders()">${p}</button>`;}).join('')}
          <button class="page-btn" onclick="ordersState.page=${page+1};loadOrders()" ${page>=pages?'disabled':''}>Next ›</button>
        </div>
      </div>`;
    } else pg.innerHTML='';
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon">⚠️</div><h3>Failed to load orders</h3><p>${e.message}</p></div></td></tr>`;
  }
}

async function updateOrderStatus(id, status) {
  try {
    await apiFetch(`${API}/orders/${id}`, { method:'PUT', body: JSON.stringify({ status }) });
    showToast('Status updated', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteOrder(id) {
  if (!confirm(`Delete order #${id}? This cannot be undone.`)) return;
  try {
    await apiFetch(`${API}/orders/${id}`, { method:'DELETE' });
    showToast('Order deleted', 'success'); loadOrders();
  } catch(e) { showToast(e.message, 'error'); }
}

async function viewOrder(id) {
  const m = document.getElementById('order-view-modal');
  const body = document.getElementById('order-view-body');
  m.classList.add('open');
  body.innerHTML = '<p style="color:var(--text-3);text-align:center;padding:30px;">Loading…</p>';
  try {
    const o = await apiFetch(`${API}/orders/${id}`);
    let items = [];
    try { items = JSON.parse(o.items); } catch {}
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div><div class="form-label">Order ID</div><div style="font-weight:700;font-family:monospace;">#${o.id}</div></div>
        <div><div class="form-label">Status</div>${statusBadge(o.status)}</div>
        <div><div class="form-label">Customer</div><div style="font-weight:600;">${o.customer_name}</div></div>
        <div><div class="form-label">Email</div><div>${o.customer_email}</div></div>
        <div><div class="form-label">Phone</div><div>${o.customer_phone||'—'}</div></div>
        <div><div class="form-label">Date</div><div>${fmtDate(o.created_at)}</div></div>
        <div><div class="form-label">Amount</div><div style="font-size:18px;font-weight:800;">${fmt(o.amount)}</div></div>
        <div><div class="form-label">Discount</div><div>${o.discount_code ? `${o.discount_code} (${fmt(o.discount_amount)})` : '—'}</div></div>
      </div>
      ${items.length ? `
      <div style="margin-top:18px;">
        <div class="form-label">Items</div>
        <div class="table-wrap" style="margin-top:8px;">
          <table>
            <thead><tr><th>ITEM</th><th>QTY</th><th>PRICE</th></tr></thead>
            <tbody>${items.map(i=>`<tr><td>${i.name}${i.variantLabel ? ` <span style="color:var(--text-3);font-size:12px;">· ${i.variantLabel}</span>` : ''}</td><td>${i.qty||1}</td><td>${fmt(i.price)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>` : ''}
    `;
  } catch(e) { body.innerHTML = `<p style="color:var(--red);">${e.message}</p>`; }
}

function ordersModal() {
  return `<div class="modal-overlay" id="order-modal">
    <div class="modal">
      <div class="modal-head"><h2 id="order-modal-title">New Order</h2><div class="modal-close" onclick="closeOrderModal()">✕</div></div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Customer Name *</label><input type="text" id="om-name" class="form-control" placeholder="Full name"></div>
          <div class="form-group"><label class="form-label">Email *</label><input type="email" id="om-email" class="form-control" placeholder="email@example.com"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Phone</label><input type="tel" id="om-phone" class="form-control" placeholder="9876543210"></div>
          <div class="form-group"><label class="form-label">Amount (₹) *</label><input type="number" id="om-amount" class="form-control" placeholder="0"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Cost (₹)</label><input type="number" id="om-cost" class="form-control" placeholder="0"></div>
          <div class="form-group"><label class="form-label">Status</label>
            <select id="om-status" class="form-control">
              <option>Pending</option><option>Processing</option><option>Completed</option><option>Cancelled</option>
            </select>
          </div>
        </div>
        <div class="form-row col-1">
          <div class="form-group"><label class="form-label">Items (JSON or description)</label><textarea id="om-items" class="form-control" rows="3" placeholder='[{"name":"Notebook","qty":1,"price":110}]'></textarea></div>
        </div>
        <div class="form-error" id="order-form-err"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeOrderModal()">Cancel</button>
        <button class="btn btn-blue" onclick="saveOrder()">Save Order</button>
      </div>
    </div>
  </div>`;
}

function orderViewModal() {
  return `<div class="modal-overlay" id="order-view-modal">
    <div class="modal modal-lg">
      <div class="modal-head"><h2>Order Details</h2><div class="modal-close" onclick="document.getElementById('order-view-modal').classList.remove('open')">✕</div></div>
      <div class="modal-body" id="order-view-body"></div>
    </div>
  </div>`;
}

function openOrderModal() { document.getElementById('order-modal').classList.add('open'); }
function closeOrderModal() { document.getElementById('order-modal').classList.remove('open'); }

async function saveOrder() {
  const errEl = document.getElementById('order-form-err');
  const name = document.getElementById('om-name').value.trim();
  const email = document.getElementById('om-email').value.trim();
  const amount = parseFloat(document.getElementById('om-amount').value);
  const cost = parseFloat(document.getElementById('om-cost').value)||0;
  const status = document.getElementById('om-status').value;
  const phone = document.getElementById('om-phone').value.trim();
  let items = document.getElementById('om-items').value.trim();
  if (!name || !email || !amount) { errEl.textContent='Name, email, and amount are required'; errEl.classList.add('show'); return; }
  if (!items) items = '[]';
  try { JSON.parse(items); } catch { items = JSON.stringify([{name:items,qty:1,price:amount}]); }
  try {
    await apiFetch(`${API}/orders`, { method:'POST', body: JSON.stringify({ customer_name:name, customer_email:email, customer_phone:phone, items, amount, cost, status }) });
    closeOrderModal(); showToast('Order created', 'success'); loadOrders();
  } catch(e) { errEl.textContent=e.message; errEl.classList.add('show'); }
}

// ─── PAGE: REVENUE ──────────────────────────────────────────────
let revState = { period:'monthly', from:'', to:'' };

async function renderRevenue() {
  const el = document.getElementById('page-revenue');
  el.innerHTML = `
    <div class="section-header"><h2>Revenue Analytics</h2></div>
    <div class="toolbar">
      <div class="period-tabs" id="rev-tabs">
        <div class="period-tab active" onclick="setRevPeriod('daily',this)">Daily</div>
        <div class="period-tab" onclick="setRevPeriod('monthly',this)">Monthly</div>
        <div class="period-tab" onclick="setRevPeriod('yearly',this)">Yearly</div>
      </div>
      <input type="date" class="date-input" id="rev-from" onchange="revState.from=this.value;loadRevenue()">
      <input type="date" class="date-input" id="rev-to" onchange="revState.to=this.value;loadRevenue()">
      <button class="btn btn-outline" onclick="revState.from='';revState.to='';document.getElementById('rev-from').value='';document.getElementById('rev-to').value='';loadRevenue()">Reset</button>
    </div>
    <div class="stats-grid" id="rev-stats"></div>
    <div class="panel">
      <div class="panel-head"><span class="panel-title">Revenue Trend</span></div>
      <div class="panel-body"><div class="chart-wrap" style="height:280px;"><canvas id="rev-chart"></canvas></div></div>
    </div>
  `;
  loadRevenue();
}

function setRevPeriod(p, el) {
  revState.period = p;
  document.querySelectorAll('#rev-tabs .period-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  loadRevenue();
}

async function loadRevenue() {
  const q = new URLSearchParams({ period:revState.period, ...(revState.from&&{from:revState.from}), ...(revState.to&&{to:revState.to}) });
  try {
    const d = await apiFetch(`${API}/revenue?${q}`);
    document.getElementById('rev-stats').innerHTML = `
      ${statCard('💰','Total Revenue',fmt(d.total),'--blue','up','')}
      ${statCard('🛍️','Total Orders',fmtNum(d.orderCount),'--purple','up','')}
      ${statCard('📊','Avg. Order Value',fmt(d.avgOrder),'--green','up','')}
    `;
    destroyChart('rev');
    const ctx = document.getElementById('rev-chart');
    if (!ctx) return;
    charts['rev'] = new Chart(ctx.getContext('2d'), {
      type:'bar',
      data:{
        labels: d.data.map(r=>r.label),
        datasets:[{
          label:'Revenue',
          data: d.data.map(r=>r.revenue),
          backgroundColor:'rgba(79,124,246,.8)', borderRadius:6, borderSkipped:false
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>'  '+fmt(c.parsed.y)}} },
        scales:{
          x:{ grid:{display:false}, ticks:{font:{size:11},color:'#9ca3af'} },
          y:{ grid:{color:'#f3f4f6'}, ticks:{font:{size:11},color:'#9ca3af',callback:v=>'₹'+Math.round(v/1000)+'K'} }
        }
      }
    });
  } catch(e) { showToast(e.message, 'error'); }
}

// ─── PAGE: PROFIT ───────────────────────────────────────────────
let profitState = { period:'monthly', from:'', to:'' };

async function renderProfit() {
  const el = document.getElementById('page-profit');
  el.innerHTML = `
    <div class="section-header"><h2>Profit Analysis</h2></div>
    <div class="toolbar">
      <div class="period-tabs" id="prof-tabs">
        <div class="period-tab active" onclick="setProfPeriod('daily',this)">Daily</div>
        <div class="period-tab" onclick="setProfPeriod('monthly',this)">Monthly</div>
        <div class="period-tab" onclick="setProfPeriod('yearly',this)">Yearly</div>
      </div>
      <input type="date" class="date-input" id="prof-from" onchange="profitState.from=this.value;loadProfit()">
      <input type="date" class="date-input" id="prof-to" onchange="profitState.to=this.value;loadProfit()">
      <button class="btn btn-outline" onclick="profitState.from='';profitState.to='';document.getElementById('prof-from').value='';document.getElementById('prof-to').value='';loadProfit()">Reset</button>
    </div>
    <div class="stats-grid" id="prof-stats"></div>
    <div class="panel">
      <div class="panel-head"><span class="panel-title">Revenue vs Cost vs Profit</span></div>
      <div class="panel-body"><div class="chart-wrap" style="height:280px;"><canvas id="prof-chart"></canvas></div></div>
    </div>
  `;
  loadProfit();
}

function setProfPeriod(p, el) {
  profitState.period = p;
  document.querySelectorAll('#prof-tabs .period-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  loadProfit();
}

async function loadProfit() {
  const q = new URLSearchParams({ period:profitState.period, ...(profitState.from&&{from:profitState.from}), ...(profitState.to&&{to:profitState.to}) });
  try {
    const d = await apiFetch(`${API}/profit?${q}`);
    const margin = d.revenue > 0 ? (d.profit/d.revenue*100).toFixed(1) : 0;
    document.getElementById('prof-stats').innerHTML = `
      ${statCard('💰','Total Revenue',fmt(d.revenue),'--blue','up','')}
      ${statCard('📦','Total Cost',fmt(d.cost),'--orange','neutral','')}
      ${statCard('📈','Net Profit',fmt(d.profit),'--green','up','')}
      ${statCard('📊','Profit Margin',margin+'%','--purple','up','')}
    `;
    destroyChart('prof');
    const ctx = document.getElementById('prof-chart');
    if (!ctx) return;
    charts['prof'] = new Chart(ctx.getContext('2d'), {
      type:'bar',
      data:{
        labels: d.data.map(r=>r.label),
        datasets:[
          { label:'Revenue', data:d.data.map(r=>r.revenue), backgroundColor:'rgba(79,124,246,.8)', borderRadius:4 },
          { label:'Cost',    data:d.data.map(r=>r.cost),    backgroundColor:'rgba(249,115,22,.7)', borderRadius:4 },
          { label:'Profit',  data:d.data.map(r=>r.profit),  backgroundColor:'rgba(34,197,94,.8)',  borderRadius:4 }
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{position:'top',labels:{font:{size:12},boxWidth:12}}, tooltip:{callbacks:{label:c=>`  ${c.dataset.label}: ${fmt(c.parsed.y)}`}} },
        scales:{
          x:{ grid:{display:false}, ticks:{font:{size:11},color:'#9ca3af'} },
          y:{ grid:{color:'#f3f4f6'}, ticks:{font:{size:11},color:'#9ca3af',callback:v=>'₹'+Math.round(v/1000)+'K'} }
        }
      }
    });
  } catch(e) { showToast(e.message, 'error'); }
}

// ─── PAGE: DISCOUNT ─────────────────────────────────────────────
async function renderDiscount() {
  const el = document.getElementById('page-discount');
  el.innerHTML = `
    <div class="section-header">
      <h2>Discount Codes</h2>
      <button class="btn btn-blue" onclick="openDiscountModal()">+ New Discount</button>
    </div>
    <div class="panel">
      <div id="discount-table-wrap" class="table-wrap">
        <table>
          <thead><tr><th>CODE</th><th>TYPE</th><th>VALUE</th><th>MIN ORDER</th><th>USES</th><th>ELIGIBLE EMAILS</th><th>ACTIVE</th><th>EXPIRES</th><th>ACTIONS</th></tr></thead>
          <tbody id="discount-tbody"><tr class="loading-row"><td colspan="9">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
    ${discountModal()}
  `;
  loadDiscounts();
}

async function loadDiscounts() {
  const tbody = document.getElementById('discount-tbody');
  if (!tbody) return;
  try {
    const discounts = await apiFetch(`${API}/discounts`);
    if (!discounts.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">🎁</div><h3>No discount codes</h3><p>Create your first discount code</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = discounts.map(d=>`<tr>
      <td><span style="font-family:monospace;font-weight:700;font-size:13px;color:var(--blue);">${d.code}</span></td>
      <td><span class="badge" style="background:#f3f4f6;color:var(--text-2);">${d.type==='percentage'?'Percentage':'Fixed'}</span></td>
      <td style="font-weight:700;">${d.type==='percentage'? d.value+'%' : fmt(d.value)}</td>
      <td>${d.min_order>0?fmt(d.min_order):'None'}</td>
      <td>${d.uses}${d.max_uses?' / '+d.max_uses:' / ∞'}</td>
      <td style="font-size:11px;max-width:220px;">${(d.allowed_emails||[]).length ? (d.allowed_emails||[]).join(', ') : '<span style=\"color:var(--text-3)\">All registered emails</span>'}</td>
      <td>
        <label class="toggle">
          <input type="checkbox" ${d.active?'checked':''} onchange="toggleDiscount(${d.id},this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td style="color:var(--text-3);font-size:12px;">${d.expires_at?fmtDate(d.expires_at):'No expiry'}</td>
      <td>
        <div style="display:flex;gap:4px;">
          <span class="icon-action" onclick="editDiscount(${JSON.stringify(d).split('"').join('&quot;')})">✏️</span>
          <span class="icon-action del" onclick="deleteDiscount(${d.id},'${d.code}')">🗑️</span>
        </div>
      </td>
    </tr>`).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">⚠️</div><h3>Failed to load</h3></div></td></tr>`;
  }
}

function discountModal() {
  return `<div class="modal-overlay" id="discount-modal">
    <div class="modal">
      <div class="modal-head"><h2 id="disc-modal-title">New Discount Code</h2><div class="modal-close" onclick="closeDiscountModal()">✕</div></div>
      <div class="modal-body">
        <input type="hidden" id="disc-id">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Code *</label><input type="text" id="disc-code" class="form-control" placeholder="WELCOME10" style="text-transform:uppercase;"></div>
          <div class="form-group"><label class="form-label">Type *</label>
            <select id="disc-type" class="form-control"><option value="percentage">Percentage (%)</option><option value="fixed">Fixed (₹)</option></select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Value *</label><input type="number" id="disc-value" class="form-control" placeholder="10"></div>
          <div class="form-group"><label class="form-label">Min Order (₹)</label><input type="number" id="disc-min" class="form-control" placeholder="0"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Max Uses</label><input type="number" id="disc-maxuses" class="form-control" placeholder="Unlimited"></div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;padding-top:22px;">
            <label class="toggle"><input type="checkbox" id="disc-active" checked><span class="toggle-slider"></span></label>
            <label class="form-label" style="margin:0;">Active</label>
          </div>
        </div>
        <div class="form-row col-1">
          <div class="form-group"><label class="form-label">Allowed Registered Emails <span style="font-weight:400;color:var(--text-3);">(optional — one per line or comma separated)</span></label><textarea id="disc-emails" class="form-control" rows="3" placeholder="student1@gmail.com
students2@gmail.com"></textarea><div style="font-size:11px;color:var(--text-3);margin-top:5px;">Leave empty to allow any registered student email.</div></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Starts At</label><input type="date" id="disc-starts" class="form-control"></div>
          <div class="form-group"><label class="form-label">Expires At</label><input type="date" id="disc-expires" class="form-control"></div>
        </div>
        <div class="form-error" id="disc-form-err"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeDiscountModal()">Cancel</button>
        <button class="btn btn-blue" onclick="saveDiscount()">Save</button>
      </div>
    </div>
  </div>`;
}

function openDiscountModal(disc=null) {
  document.getElementById('disc-modal-title').textContent = disc ? 'Edit Discount' : 'New Discount Code';
  document.getElementById('disc-id').value = disc ? disc.id : '';
  document.getElementById('disc-code').value = disc ? disc.code : '';
  document.getElementById('disc-type').value = disc ? disc.type : 'percentage';
  document.getElementById('disc-value').value = disc ? disc.value : '';
  document.getElementById('disc-min').value = disc ? disc.min_order : '';
  document.getElementById('disc-maxuses').value = disc ? (disc.max_uses||'') : '';
  document.getElementById('disc-active').checked = disc ? !!disc.active : true;
  document.getElementById('disc-starts').value = disc ? (disc.starts_at||'').slice(0,10) : new Date().toISOString().slice(0,10);
  document.getElementById('disc-expires').value = disc ? (disc.expires_at||'').slice(0,10) : '';
  document.getElementById('disc-emails').value = disc ? (disc.allowed_emails||[]).join('\n') : '';
  document.getElementById('disc-form-err').classList.remove('show');
  document.getElementById('discount-modal').classList.add('open');
}

function closeDiscountModal() { document.getElementById('discount-modal').classList.remove('open'); }

function editDiscount(d) { openDiscountModal(d); }

async function saveDiscount() {
  const id = document.getElementById('disc-id').value;
  const code = document.getElementById('disc-code').value.trim().toUpperCase();
  const type = document.getElementById('disc-type').value;
  const value = parseFloat(document.getElementById('disc-value').value);
  const min_order = parseFloat(document.getElementById('disc-min').value)||0;
  const max_uses = parseInt(document.getElementById('disc-maxuses').value)||null;
  const active = document.getElementById('disc-active').checked;
  const starts_at = document.getElementById('disc-starts').value;
  const expires_at = document.getElementById('disc-expires').value||null;
  const allowed_emails = document.getElementById('disc-emails').value.split(/[,\n]+/).map(e=>e.trim().toLowerCase()).filter(Boolean);
  const errEl = document.getElementById('disc-form-err');
  if (!code || !value) { errEl.textContent='Code and value are required'; errEl.classList.add('show'); return; }
  try {
    if (id) await apiFetch(`${API}/discounts/${id}`, { method:'PUT', body: JSON.stringify({code,type,value,min_order,max_uses,active,starts_at,expires_at,allowed_emails}) });
    else await apiFetch(`${API}/discounts`, { method:'POST', body: JSON.stringify({code,type,value,min_order,max_uses,active,starts_at,expires_at,allowed_emails}) });
    closeDiscountModal(); showToast(id?'Discount updated':'Discount created','success'); loadDiscounts();
  } catch(e) { errEl.textContent=e.message; errEl.classList.add('show'); }
}

async function toggleDiscount(id, active) {
  const disc = (await apiFetch(`${API}/discounts`)).find(d=>d.id===id);
  if (!disc) return;
  try {
    await apiFetch(`${API}/discounts/${id}`, { method:'PUT', body: JSON.stringify({...disc, active}) });
    showToast(active?'Discount activated':'Discount deactivated','success');
  } catch(e) { showToast(e.message,'error'); loadDiscounts(); }
}

async function deleteDiscount(id, code) {
  if (!confirm(`Delete discount code "${code}"?`)) return;
  try {
    await apiFetch(`${API}/discounts/${id}`, { method:'DELETE' });
    showToast('Discount deleted','success'); loadDiscounts();
  } catch(e) { showToast(e.message,'error'); }
}

// ─── PAGE: SUPPORT ──────────────────────────────────────────────
let supportState = { page:1, search:'', status:'', priority:'' };

async function renderSupport() {
  const el = document.getElementById('page-support');
  el.innerHTML = `
    <div class="section-header">
      <h2>Customer Support</h2>
      <button class="btn btn-blue" onclick="openSupportModal()">+ New Ticket</button>
    </div>
    <div class="panel">
      <div class="panel-body" style="padding-bottom:0;">
        <div class="toolbar">
          <div class="search-input">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Search customer, subject, message…" id="sup-search" oninput="debouncedSupportSearch()">
          </div>
          <select class="filter-select" id="sup-status" onchange="supportState.status=this.value;supportState.page=1;loadSupport()">
            <option value="">All Statuses</option>
            <option value="Open">Open</option>
            <option value="In Progress">In Progress</option>
            <option value="Resolved">Resolved</option>
          </select>
          <select class="filter-select" id="sup-priority" onchange="supportState.priority=this.value;supportState.page=1;loadSupport()">
            <option value="">All Priorities</option>
            <option value="High">High</option>
            <option value="Normal">Normal</option>
          </select>
          <button class="btn btn-outline" onclick="supportState={page:1,search:'',status:'',priority:''};renderSupport()">Reset</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>CUSTOMER</th><th>SUBJECT</th><th>PRIORITY</th><th>STATUS</th><th>DATE</th><th>ACTIONS</th></tr></thead>
          <tbody id="support-tbody"><tr class="loading-row"><td colspan="7">Loading…</td></tr></tbody>
        </table>
      </div>
      <div class="panel-body" style="padding-top:0;" id="support-pagination"></div>
    </div>
    ${supportModal()}
    ${supportViewModal()}
  `;
  loadSupport();
}

const debouncedSupportSearch = debounce(() => {
  supportState.search = document.getElementById('sup-search')?.value || '';
  supportState.page = 1;
  loadSupport();
}, 350);

async function loadSupport() {
  const tbody = document.getElementById('support-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr class="loading-row"><td colspan="7">Loading…</td></tr>`;
  const { page, search, status, priority } = supportState;
  const q = new URLSearchParams({ page, limit:15, ...(search&&{search}), ...(status&&{status}), ...(priority&&{priority}) });
  try {
    const { tickets, total } = await apiFetch(`${API}/support?${q}`);
    if (!tickets.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="icon">💬</div><h3>No tickets found</h3></div></td></tr>`;
      return;
    }
    tbody.innerHTML = tickets.map(t=>`<tr>
      <td style="font-size:12px;color:var(--text-3);">#${t.id}</td>
      <td>
        <div style="font-weight:600;font-size:13px;">${t.customer_name}</div>
        <div style="font-size:11.5px;color:var(--text-3);">${t.customer_email}</div>
      </td>
      <td style="max-width:200px;"><div style="font-weight:500;">${t.subject||'—'}</div><div style="font-size:11.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${t.message}</div></td>
      <td><span class="badge" style="${t.priority==='High'?'color:#dc2626;background:#fef2f2;':'color:var(--text-3);background:#f3f4f6;'}">${t.priority}</span></td>
      <td>
        <select onchange="updateTicketStatus(${t.id},this.value)" style="border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;">
          ${['Open','In Progress','Resolved'].map(s=>`<option${s===t.status?' selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td style="color:var(--text-3);font-size:12px;">${fmtDate(t.created_at)}</td>
      <td>
        <div style="display:flex;gap:4px;">
          <span class="icon-action" onclick="viewTicket(${t.id})">👁️</span>
          <span class="icon-action del" onclick="deleteTicket(${t.id})">🗑️</span>
        </div>
      </td>
    </tr>`).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="icon">⚠️</div><h3>Failed to load</h3></div></td></tr>`;
  }
}

function supportModal() {
  return `<div class="modal-overlay" id="support-modal">
    <div class="modal">
      <div class="modal-head"><h2>New Support Ticket</h2><div class="modal-close" onclick="closeSupportModal()">✕</div></div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Customer Name *</label><input type="text" id="sm-name" class="form-control"></div>
          <div class="form-group"><label class="form-label">Email</label><input type="email" id="sm-email" class="form-control"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Phone</label><input type="tel" id="sm-phone" class="form-control"></div>
          <div class="form-group"><label class="form-label">Priority</label>
            <select id="sm-priority" class="form-control"><option>Normal</option><option>High</option></select>
          </div>
        </div>
        <div class="form-group"><label class="form-label">Subject</label><input type="text" id="sm-subject" class="form-control" placeholder="Brief description"></div>
        <div class="form-group"><label class="form-label">Message *</label><textarea id="sm-message" class="form-control" rows="4" placeholder="Describe the issue…"></textarea></div>
        <div class="form-error" id="sup-form-err"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeSupportModal()">Cancel</button>
        <button class="btn btn-blue" onclick="saveSupportTicket()">Create Ticket</button>
      </div>
    </div>
  </div>`;
}

function supportViewModal() {
  return `<div class="modal-overlay" id="support-view-modal">
    <div class="modal modal-lg">
      <div class="modal-head"><h2>Ticket Details</h2><div class="modal-close" onclick="document.getElementById('support-view-modal').classList.remove('open')">✕</div></div>
      <div class="modal-body" id="support-view-body"></div>
      <div class="modal-footer" id="support-view-footer"></div>
    </div>
  </div>`;
}

function openSupportModal() { document.getElementById('support-modal').classList.add('open'); }
function closeSupportModal() { document.getElementById('support-modal').classList.remove('open'); }

async function saveSupportTicket() {
  const errEl = document.getElementById('sup-form-err');
  const name = document.getElementById('sm-name').value.trim();
  const email = document.getElementById('sm-email').value.trim();
  const phone = document.getElementById('sm-phone').value.trim();
  const subject = document.getElementById('sm-subject').value.trim();
  const message = document.getElementById('sm-message').value.trim();
  const priority = document.getElementById('sm-priority').value;
  if (!name || !message) { errEl.textContent='Name and message required'; errEl.classList.add('show'); return; }
  try {
    await apiFetch(`${API}/support`, { method:'POST', body: JSON.stringify({ customer_name:name, customer_email:email, customer_phone:phone, subject, message, priority }) });
    closeSupportModal(); showToast('Ticket created','success'); loadSupport();
  } catch(e) { errEl.textContent=e.message; errEl.classList.add('show'); }
}

async function updateTicketStatus(id, status) {
  try {
    await apiFetch(`${API}/support/${id}`, { method:'PUT', body: JSON.stringify({ status }) });
    showToast('Status updated','success');
  } catch(e) { showToast(e.message,'error'); }
}

async function viewTicket(id) {
  const m = document.getElementById('support-view-modal');
  const body = document.getElementById('support-view-body');
  const footer = document.getElementById('support-view-footer');
  m.classList.add('open');
  body.innerHTML = '<p style="color:var(--text-3);text-align:center;padding:30px;">Loading…</p>';
  try {
    const tickets = await apiFetch(`${API}/support?page=1&limit=100`);
    const t = tickets.tickets.find(tt=>tt.id===id);
    if (!t) { body.innerHTML='<p>Not found</p>'; return; }
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div><div class="form-label">Customer</div><div style="font-weight:600;">${t.customer_name}</div></div>
        <div><div class="form-label">Email</div><div>${t.customer_email||'—'}</div></div>
        <div><div class="form-label">Phone</div><div>${t.customer_phone||'—'}</div></div>
        <div><div class="form-label">Priority</div><span class="badge" style="${t.priority==='High'?'color:#dc2626;background:#fef2f2;':'color:var(--text-3);background:#f3f4f6;'}">${t.priority}</span></div>
        <div><div class="form-label">Status</div>${statusBadge(t.status)}</div>
        <div><div class="form-label">Date</div><div style="color:var(--text-3);">${fmtDate(t.created_at)}</div></div>
      </div>
      <div class="form-group"><div class="form-label">Subject</div><div style="font-weight:600;">${t.subject||'—'}</div></div>
      <div class="form-group"><div class="form-label">Message</div>
        <div style="background:var(--surface);border-radius:8px;padding:14px;font-size:13px;line-height:1.7;">${t.message}</div>
      </div>
      <div class="form-group"><label class="form-label">Admin Notes</label>
        <textarea id="ticket-notes-${t.id}" class="form-control" rows="3" placeholder="Add internal notes…">${t.notes||''}</textarea>
      </div>
    `;
    footer.innerHTML = `
      <button class="btn btn-outline" onclick="document.getElementById('support-view-modal').classList.remove('open')">Close</button>
      <button class="btn btn-success" onclick="saveTicketNotes(${t.id})">Save Notes</button>
    `;
  } catch(e) { body.innerHTML = `<p style="color:var(--red);">${e.message}</p>`; }
}

async function saveTicketNotes(id) {
  const notes = document.getElementById(`ticket-notes-${id}`)?.value || '';
  try {
    await apiFetch(`${API}/support/${id}`, { method:'PUT', body: JSON.stringify({ notes }) });
    showToast('Notes saved','success');
  } catch(e) { showToast(e.message,'error'); }
}

async function deleteTicket(id) {
  if (!confirm('Delete this support ticket?')) return;
  try {
    await apiFetch(`${API}/support/${id}`, { method:'DELETE' });
    showToast('Ticket deleted','success'); loadSupport();
  } catch(e) { showToast(e.message,'error'); }
}


// ─── PAGE: PRODUCTS ─────────────────────────────────────────────
let productsState = { page:1, search:'', category:'', active:'' };
let editingVariants = []; // variants being edited in modal

async function renderProducts() {
  const el = document.getElementById('page-products');
  el.innerHTML = `
    <div class="section-header">
      <h2>Products</h2>
      <button class="btn btn-blue" onclick="openProductModal()">+ Add Product</button>
    </div>
    <div class="panel">
      <div class="panel-body" style="padding-bottom:0;">
        <div class="toolbar">
          <div class="search-input">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Search name, description, badge…" id="prod-search" oninput="debouncedProductSearch()" value="${productsState.search}">
          </div>
          <select class="filter-select" id="prod-cat" onchange="productsState.category=this.value;productsState.page=1;loadProducts()">
            <option value="">All Categories</option>
            <option value="stationary">Stationary</option>
            <option value="gym">Gym</option>
            <option value="hostel">Hostel</option>
            <option value="laptop">Laptop</option>
          </select>
          <select class="filter-select" id="prod-active" onchange="productsState.active=this.value;productsState.page=1;loadProducts()">
            <option value="">All Status</option>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
          <button class="btn btn-outline" onclick="productsState={page:1,search:'',category:'',active:''};renderProducts()">Reset</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>PRICE</th><th>COST</th><th>PROFIT</th><th>STOCK</th><th>VARIANTS</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
          <tbody id="products-tbody"><tr class="loading-row"><td colspan="9">Loading…</td></tr></tbody>
        </table>
      </div>
      <div class="panel-body" style="padding-top:0;" id="products-pagination"></div>
    </div>
    ${productModal()}
    ${variantViewModal()}
  `;
  document.getElementById('prod-cat').value = productsState.category;
  document.getElementById('prod-active').value = productsState.active;
  loadProducts();
}

const debouncedProductSearch = debounce(() => {
  productsState.search = document.getElementById('prod-search')?.value || '';
  productsState.page = 1;
  loadProducts();
}, 350);

async function loadProducts() {
  const tbody = document.getElementById('products-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr class="loading-row"><td colspan="9">Loading…</td></tr>`;
  const { page, search, category, active } = productsState;
  const q = new URLSearchParams({ page, limit:15, ...(search&&{search}), ...(category&&{category}), ...(active!==''&&{active}) });
  try {
    const { products, total, limit } = await apiFetch(`${API}/products?${q}`);
    if (!products.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">📦</div><h3>No products found</h3><p>Add your first product using the button above</p></div></td></tr>`;
      document.getElementById('products-pagination').innerHTML = '';
      return;
    }
    tbody.innerHTML = products.map(p => `<tr>
      <td style="min-width:220px;">
        ${p.image ? `<img src="${p.image}" style="width:36px;height:36px;border-radius:8px;object-fit:cover;display:inline-block;vertical-align:middle;margin-right:8px;" onerror="this.style.display='none'">` : ''}
        <span style="font-weight:600;vertical-align:middle;">${p.name}</span>
        ${p.badge ? `<span class="badge" style="margin-left:6px;background:var(--blue-light);color:var(--blue);font-size:11px;">${p.badge}</span>` : ''}
        <div style="font-size:11.5px;color:var(--text-3);margin-top:2px;font-family:monospace;">${p.id}</div>
      </td>
      <td><span class="badge" style="background:#f3f4f6;color:var(--text-2);">${p.category_label||p.category}</span></td>
      <td style="font-weight:700;">${fmt(p.price)}</td>
      <td>${fmt(p.cost_price||0)}</td>
      <td>${fmt(Math.max(0,(Number(p.price)||0)-(Number(p.cost_price)||0)))} <span style="font-size:11px;color:var(--text-3);">/unit</span></td>
      
      <td>${p.stock_count}</td>
      <td>
        ${p.variants && p.variants.length
          ? `<span style="font-size:12px;color:var(--blue);font-weight:600;cursor:pointer;text-decoration:underline;" onclick="openVariantViewModal('${p.id}','${p.name.replace(/'/g,"\\'")}')">
               ${p.variants.length} variant${p.variants.length>1?'s':''}
             </span>`
          : `<span style="color:var(--text-3);font-size:12px;">None</span>`}
      </td>
      <td>
        <label class="toggle">
          <input type="checkbox" ${p.active?'checked':''} onchange="toggleProductActive('${p.id}',this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        <div style="display:flex;gap:4px;">
          <span class="icon-action" title="Edit" onclick="editProduct('${p.id}')">✏️</span>
          <span class="icon-action del" title="Delete" onclick="deleteProduct('${p.id}','${p.name.replace(/'/g,"\\'")}')">🗑️</span>
        </div>
      </td>
    </tr>`).join('');
    const pages = Math.ceil(total / limit);
    const pg = document.getElementById('products-pagination');
    if (pages > 1) {
      pg.innerHTML = `<div class="pagination">
        <span class="pagination-info">Showing ${(page-1)*limit+1}–${Math.min(page*limit,total)} of ${total} products</span>
        <div class="pagination-btns">
          <button class="page-btn" onclick="productsState.page=${page-1};loadProducts()" ${page<=1?'disabled':''}>‹ Prev</button>
          ${Array.from({length:Math.min(pages,5)},(_,i)=>{const p=i+1;return`<button class="page-btn${p===page?' active':''}" onclick="productsState.page=${p};loadProducts()">${p}</button>`;}).join('')}
          <button class="page-btn" onclick="productsState.page=${page+1};loadProducts()" ${page>=pages?'disabled':''}>Next ›</button>
        </div>
      </div>`;
    } else pg.innerHTML = '';
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">⚠️</div><h3>Failed to load</h3><p>${e.message}</p></div></td></tr>`;
  }
}

// ─── PRODUCT MODAL ───────────────────────────────────────────────
function productModal() {
  return `
  <div class="modal-overlay" id="product-modal">
    <div class="modal modal-lg" style="max-width:740px;">
      <div class="modal-head">
        <h2 id="prod-modal-title">Add Product</h2>
        <div class="modal-close" onclick="closeProductModal()">✕</div>
      </div>
      <div class="modal-body">
        <input type="hidden" id="prod-edit-id">

        <!-- Basic Info -->
        <div style="font-size:13px;font-weight:700;color:var(--text-2);margin-bottom:10px;letter-spacing:.3px;">BASIC INFO</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Product ID * <span style="font-weight:400;color:var(--text-3);">(slug, e.g. stat-004)</span></label>
            <input type="text" id="prod-id-input" class="form-control" placeholder="stat-004" style="font-family:monospace;">
          </div>
          <div class="form-group">
            <label class="form-label">Product Name *</label>
            <input type="text" id="prod-name" class="form-control" placeholder="e.g. Practical Notebook">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Category *</label>
            <select id="prod-category" class="form-control" onchange="updateCategoryLabel()">
              <option value="stationary">Stationary</option>
              <option value="gym">Gym</option>
              <option value="hostel">Hostel</option>
              <option value="laptop">Laptop</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Category Label</label>
            <input type="text" id="prod-cat-label" class="form-control" placeholder="Stationary Essentials">
          </div>
        </div>
        <div class="form-row col-1">
          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea id="prod-desc" class="form-control" rows="2" placeholder="Short product description…"></textarea>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Badge <span style="font-weight:400;color:var(--text-3);">(e.g. Popular, Official 200 Pages)</span></label>
            <input type="text" id="prod-badge" class="form-control" placeholder="Popular">
          </div>
          <div class="form-group">
            <label class="form-label">Tags <span style="font-weight:400;color:var(--text-3);">(comma separated)</span></label>
            <input type="text" id="prod-tags" class="form-control" placeholder="notebook, lab, stationary">
          </div>
        </div>

        <!-- Pricing & Stock -->
        <div style="font-size:13px;font-weight:700;color:var(--text-2);margin:18px 0 10px;letter-spacing:.3px;">PRICING & STOCK</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Selling Price (₹) *</label><input type="number" id="prod-price" class="form-control" placeholder="110" min="0" step="0.01" oninput="updateProductProfitPreview()"></div>
          <div class="form-group"><label class="form-label">Cost Price (₹) *</label><input type="number" id="prod-cost-price" class="form-control" placeholder="70" min="0" step="0.01" oninput="updateProductProfitPreview()"><div style="font-size:11px;color:var(--text-3);margin-top:4px;">Your purchase/actual cost. Used for profit calculation.</div></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Expected Profit (₹)</label><input type="text" id="prod-profit-preview" class="form-control" value="₹0" readonly></div>
          <div class="form-group"><label class="form-label">Stock Count</label><input type="number" id="prod-stock" class="form-control" placeholder="0"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Rating</label><input type="number" id="prod-rating" class="form-control" placeholder="4.8" step="0.1" min="0" max="5"></div>
        </div>

        <!-- Image & Gallery -->
        <div style="font-size:13px;font-weight:700;color:var(--text-2);margin:18px 0 10px;letter-spacing:.3px;">IMAGE</div>
        <div class="form-row col-1">
          <div class="form-group">
            <label class="form-label">Main Product Photo</label>
            <input type="file" id="prod-image-file" class="form-control" accept="image/*" onchange="handleProductImageUpload(event)">
            <div style="font-size:11px;color:var(--text-3);margin-top:5px;">Upload JPG/PNG/WebP. Image is compressed before saving.</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:3px;">Or use an existing URL/path:</div>
            <input type="text" id="prod-image" class="form-control" placeholder="assets/images/product.jpg or https://…" oninput="updateProdImgPreview()">
          </div>
        </div>
        <div id="prod-img-preview" style="margin-bottom:12px;display:none;">
          <img id="prod-img-el" src="" style="height:72px;border-radius:8px;object-fit:cover;border:1px solid var(--border);" onerror="document.getElementById('prod-img-preview').style.display='none'">
        </div>
        <div class="form-row col-1">
          <div class="form-group">
            <label class="form-label">Gallery <span style="font-weight:400;color:var(--text-3);">(comma-separated URLs/paths)</span></label>
            <input type="text" id="prod-gallery" class="form-control" placeholder="assets/images/a.jpg, assets/images/b.jpg">
          </div>
        </div>

        <!-- Specs -->
        <div style="font-size:13px;font-weight:700;color:var(--text-2);margin:18px 0 10px;letter-spacing:.3px;">SPECS</div>
        <div class="form-row col-1">
          <div class="form-group">
            <label class="form-label">Specs <span style="font-weight:400;color:var(--text-3);">(one per line)</span></label>
            <textarea id="prod-specs" class="form-control" rows="3" placeholder="200 Pages (100 Sheets)&#10;Hardbound laminated cover&#10;Pre-printed Index"></textarea>
          </div>
        </div>

        <!-- Active -->
        <div style="display:flex;align-items:center;gap:10px;margin:14px 0 20px;">
          <label class="toggle"><input type="checkbox" id="prod-active-chk" checked><span class="toggle-slider"></span></label>
          <label class="form-label" style="margin:0;">Active (visible on store)</label>
        </div>

        <!-- VARIANTS -->
        <div style="border-top:1px solid var(--border);padding-top:18px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--text-2);">VARIANTS</div>
              <div style="font-size:12px;color:var(--text-3);margin-top:2px;">Each variant has its own label, price, and stock</div>
            </div>
            <button class="btn btn-outline btn-sm" onclick="addVariantRow()">+ Add Variant</button>
          </div>
          <div id="variants-editor"></div>
        </div>

        <div class="form-error" id="prod-form-err"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeProductModal()">Cancel</button>
        <button class="btn btn-blue" onclick="saveProduct()">Save Product</button>
      </div>
    </div>
  </div>`;
}

function variantViewModal() {
  return `
  <div class="modal-overlay" id="var-view-modal">
    <div class="modal">
      <div class="modal-head">
        <h2 id="var-view-title">Variants</h2>
        <div class="modal-close" onclick="document.getElementById('var-view-modal').classList.remove('open')">✕</div>
      </div>
      <div class="modal-body" id="var-view-body"></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('var-view-modal').classList.remove('open')">Close</button>
        <button class="btn btn-blue btn-sm" id="var-view-edit-btn">Edit Variants</button>
      </div>
    </div>
  </div>`;
}

// Category label auto-fill
const CAT_LABELS = { stationary:'Stationary Essentials', gym:'Gym Essentials', hostel:'Hostel Essentials', laptop:'Laptop Accessories' };
function updateCategoryLabel() {
  const cat = document.getElementById('prod-category').value;
  const lbl = document.getElementById('prod-cat-label');
  if (!lbl.value || Object.values(CAT_LABELS).includes(lbl.value)) {
    lbl.value = CAT_LABELS[cat] || '';
  }
}

async function handleProductImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); event.target.value=''; return; }
  if (file.size > 8 * 1024 * 1024) { showToast('Image must be smaller than 8MB', 'error'); event.target.value=''; return; }
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => { img.onload = () => {
        const max = 1200;
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.72));
      }; img.onerror = reject; img.src = reader.result; };
      reader.onerror = reject; reader.readAsDataURL(file);
    });
    if (dataUrl.length > 500000) throw new Error('Image is still too large after compression');
    document.getElementById('prod-image').value = dataUrl;
    updateProdImgPreview();
    showToast('Product photo ready', 'success');
  } catch (e) {
    showToast('Could not process image', 'error');
    event.target.value='';
  }
}

function updateProdImgPreview() {
  const url = document.getElementById('prod-image').value.trim();
  const wrap = document.getElementById('prod-img-preview');
  const img  = document.getElementById('prod-img-el');
  if (url) { img.src = url; wrap.style.display = 'block'; }
  else { wrap.style.display = 'none'; }
}

async function handleVariantImageUpload(index, event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); event.target.value=''; return; }
  if (file.size > 8 * 1024 * 1024) { showToast('Image must be smaller than 8MB', 'error'); event.target.value=''; return; }
  try {
    const dataUrl = await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      const img=new Image();
      reader.onload=()=>{ img.onload=()=>{
        const max=1200, scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
        const canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
        canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL('image/webp',0.72));
      }; img.onerror=reject; img.src=reader.result; };
      reader.onerror=reject; reader.readAsDataURL(file);
    });
    if (dataUrl.length > 500000) throw new Error('Image is still too large after compression');
    editingVariants[index].image=dataUrl;
    renderVariantEditor();
    showToast('Variant image ready — save the product to persist it','success');
  } catch(e) {
    showToast(e.message || 'Could not process variant image','error');
    event.target.value='';
  }
}

function renderVariantEditor() {
  const el = document.getElementById('variants-editor');
  if (!el) return;
  if (!editingVariants.length) {
    el.innerHTML = `<div style="text-align:center;color:var(--text-3);font-size:13px;padding:14px 0;">No variants yet</div>`;
    return;
  }
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(160px,1fr) 100px 100px 80px minmax(150px,180px) 36px;gap:8px;padding:0 2px;margin-bottom:4px;">
      <span style="font-size:11px;color:var(--text-3);font-weight:700;">LABEL</span>
      <span style="font-size:11px;color:var(--text-3);font-weight:700;">PRICE (₹)</span>
      <span style="font-size:11px;color:var(--text-3);font-weight:700;">COST (₹)</span>
      <span style="font-size:11px;color:var(--text-3);font-weight:700;">STOCK</span>
      <span style="font-size:11px;color:var(--text-3);font-weight:700;">IMAGE</span>
      <span></span>
    </div>
    ${editingVariants.map((v, i) => `
    <div style="display:grid;grid-template-columns:minmax(160px,1fr) 100px 100px 80px minmax(150px,180px) 36px;gap:8px;align-items:center;margin-bottom:9px;">
      <input type="text" class="form-control" placeholder="e.g. 200 Pages, Size L" value="${String(v.label||'').replace(/"/g,'&quot;')}" oninput="editingVariants[${i}].label=this.value" style="font-size:13px;">
      <input type="number" class="form-control" placeholder="0" value="${v.price||0}" oninput="editingVariants[${i}].price=parseFloat(this.value)||0" style="font-size:13px;">
      <input type="number" class="form-control" placeholder="0" value="${v.cost||0}" oninput="editingVariants[${i}].cost=parseFloat(this.value)||0" style="font-size:13px;">
      <input type="number" class="form-control" placeholder="0" value="${v.stock||0}" oninput="editingVariants[${i}].stock=parseInt(this.value)||0" style="font-size:13px;">
      <div>
        <input type="file" accept="image/*" class="form-control" onchange="handleVariantImageUpload(${i},event)" style="font-size:11px;padding:5px;">
        ${v.image ? `<div style="display:flex;align-items:center;gap:7px;margin-top:5px;">
          <img src="${v.image}" style="width:42px;height:42px;border:1px solid var(--border);border-radius:6px;object-fit:cover;" onerror="this.style.display='none'">
          <button type="button" onclick="editingVariants[${i}].image='';renderVariantEditor()" style="font-size:10px;color:#dc2626;">Remove</button>
        </div>` : `<div style="font-size:10px;color:var(--text-3);margin-top:3px;">Uses product image if empty</div>`}
      </div>
      <span class="icon-action del" onclick="removeVariantRow(${i})" title="Remove" style="text-align:center;">✕</span>
    </div>`).join('')}`;
}

function addVariantRow() {
  editingVariants.push({ label:'', price:0, cost:0, stock:0, active:1, image:'' });
  renderVariantEditor();
}

function removeVariantRow(i) {
  editingVariants.splice(i, 1);
  renderVariantEditor();
}

async function openProductModal(product=null) {
  editingVariants = product ? (product.variants||[]).map(v=>({...v})) : [];
  const isEdit = !!product;
  document.getElementById('prod-modal-title').textContent = isEdit ? 'Edit Product' : 'Add Product';
  document.getElementById('prod-edit-id').value = isEdit ? product.id : '';
  // ID field: readonly on edit
  const idInput = document.getElementById('prod-id-input');
  idInput.value = isEdit ? product.id : '';
  idInput.readOnly = isEdit;
  idInput.style.background = isEdit ? 'var(--surface)' : '';
  document.getElementById('prod-name').value = product?.name || '';
  document.getElementById('prod-category').value = product?.category || 'stationary';
  document.getElementById('prod-cat-label').value = product?.category_label || '';
  document.getElementById('prod-desc').value = product?.description || '';
  document.getElementById('prod-badge').value = product?.badge || '';
  document.getElementById('prod-price').value = product?.price ?? '';
  document.getElementById('prod-cost-price').value = product?.cost_price ?? '';
  updateProductProfitPreview();
  document.getElementById('prod-stock').value = product?.stock_count ?? '';
  document.getElementById('prod-rating').value = product?.rating ?? 4.8;
  document.getElementById('prod-image').value = product?.image || '';
  const imageFileInput = document.getElementById('prod-image-file');
  if (imageFileInput) imageFileInput.value = '';
  document.getElementById('prod-active-chk').checked = product ? !!product.active : true;
  document.getElementById('prod-form-err').classList.remove('show');
  // Tags: JSON array → comma string
  try { document.getElementById('prod-tags').value = product?.tags ? JSON.parse(product.tags).join(', ') : ''; } catch { document.getElementById('prod-tags').value = product?.tags||''; }
  // Gallery: JSON array → comma string
  try { document.getElementById('prod-gallery').value = product?.gallery ? JSON.parse(product.gallery).join(', ') : ''; } catch { document.getElementById('prod-gallery').value = product?.gallery||''; }
  // Specs: JSON array → newline string
  try { document.getElementById('prod-specs').value = product?.specs ? JSON.parse(product.specs).join('\n') : ''; } catch { document.getElementById('prod-specs').value = product?.specs||''; }
  updateProdImgPreview();
  document.getElementById('product-modal').classList.add('open');
  renderVariantEditor();
}

function closeProductModal() {
  document.getElementById('product-modal').classList.remove('open');
  editingVariants = [];
}

async function editProduct(id) {
  try {
    const p = await apiFetch(`${API}/products/${id}`);
    openProductModal(p);
  } catch(e) { showToast(e.message, 'error'); }
}

function updateProductProfitPreview() {
  const price = parseFloat(document.getElementById('prod-price')?.value)||0;
  const cost = parseFloat(document.getElementById('prod-cost-price')?.value)||0;
  const el = document.getElementById('prod-profit-preview');
  if (el) el.value = '₹' + Math.max(0, price-cost).toFixed(2);
}
async function saveProduct() {
  const errEl = document.getElementById('prod-form-err');
  errEl.classList.remove('show');
  const editId = document.getElementById('prod-edit-id').value;
  const id = document.getElementById('prod-id-input').value.trim();
  const name = document.getElementById('prod-name').value.trim();
  const category = document.getElementById('prod-category').value;
  const category_label = document.getElementById('prod-cat-label').value.trim();
  const description = document.getElementById('prod-desc').value.trim();
  const badge = document.getElementById('prod-badge').value.trim();
  const price = parseFloat(document.getElementById('prod-price').value)||0;
  const costRaw = document.getElementById('prod-cost-price').value.trim();
  const cost_price = parseFloat(costRaw)||0;
  const stock_count = parseInt(document.getElementById('prod-stock').value)||0;
  const rating = parseFloat(document.getElementById('prod-rating').value)||4.8;
  const image = document.getElementById('prod-image').value.trim();
  const active = document.getElementById('prod-active-chk').checked;
  // Parse tags/gallery/specs
  const tagsRaw = document.getElementById('prod-tags').value.trim();
  const tags = JSON.stringify(tagsRaw ? tagsRaw.split(',').map(s=>s.trim()).filter(Boolean) : []);
  const galleryRaw = document.getElementById('prod-gallery').value.trim();
  const gallery = JSON.stringify(galleryRaw ? galleryRaw.split(',').map(s=>s.trim()).filter(Boolean) : []);
  const specsRaw = document.getElementById('prod-specs').value.trim();
  const specs = JSON.stringify(specsRaw ? specsRaw.split('\n').map(s=>s.trim()).filter(Boolean) : []);
  if (!id || !name || !price || !costRaw || cost_price < 0) { errEl.textContent='ID, Name, Selling Price and Cost Price are required'; errEl.classList.add('show'); return; }
  for (const v of editingVariants) {
    if (!v.label.trim()) { errEl.textContent='Each variant must have a Label'; errEl.classList.add('show'); return; }
  }
  const body = { id, name, category, category_label, description, badge, price, cost_price, stock_count, rating, image, gallery, specs, tags, active, variants: editingVariants };
  try {
    if (editId) await apiFetch(`${API}/products/${editId}`, { method:'PUT', body: JSON.stringify(body) });
    else await apiFetch(`${API}/products`, { method:'POST', body: JSON.stringify(body) });
    closeProductModal();
    showToast(editId ? 'Product updated' : 'Product created', 'success');
    loadProducts();
  } catch(e) { errEl.textContent = e.message; errEl.classList.add('show'); }
}

async function toggleProductActive(id, active) {
  try {
    await apiFetch(`${API}/products/${id}`, { method:'PUT', body: JSON.stringify({ active }) });
    showToast(active ? 'Product activated' : 'Product deactivated', 'success');
  } catch(e) { showToast(e.message, 'error'); loadProducts(); }
}

async function deleteProduct(id, name) {
  if (!confirm(`Delete "${name}"? This also removes all its variants.`)) return;
  try {
    await apiFetch(`${API}/products/${id}`, { method:'DELETE' });
    showToast('Product deleted', 'success');
    loadProducts();
  } catch(e) { showToast(e.message, 'error'); }
}

async function openVariantViewModal(id, name) {
  const modal = document.getElementById('var-view-modal');
  const body  = document.getElementById('var-view-body');
  document.getElementById('var-view-title').textContent = name + ' — Variants';
  document.getElementById('var-view-edit-btn').onclick = () => { modal.classList.remove('open'); editProduct(id); };
  modal.classList.add('open');
  body.innerHTML = '<p style="color:var(--text-3);text-align:center;padding:30px;">Loading…</p>';
  try {
    const p = await apiFetch(`${API}/products/${id}`);
    if (!p.variants || !p.variants.length) {
      body.innerHTML = '<div class="empty-state"><div class="icon">🔖</div><h3>No variants</h3></div>';
      return;
    }
    body.innerHTML = `<div class="table-wrap">
      <table>
        <thead><tr><th>LABEL</th><th>PRICE</th><th>STOCK</th><th>ACTIVE</th></tr></thead>
        <tbody>
          ${p.variants.map(v=>`<tr>
            <td style="font-weight:600;">${v.label}</td>
            <td style="font-weight:700;">${fmt(v.price)}</td>
            <td>${v.stock}</td>
            <td>${v.active ? '<span class="badge badge-completed">Yes</span>' : '<span class="badge badge-cancelled">No</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  } catch(e) { body.innerHTML = `<p style="color:var(--red);">${e.message}</p>`; }
}


// ─── DEBOUNCE HELPER ────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return function(...args) { clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), ms); };
}

// ─── BOOT ───────────────────────────────────────────────────────
(async function boot() {
  try {
    const me = await apiFetch(`${API}/me`);
    initApp(me.email);
  } catch {
    document.getElementById('login-screen').style.display = 'flex';
  }
})();
