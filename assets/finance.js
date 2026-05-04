'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let accounts = PortfolioStorage.getJson('ft_accounts', []);
let chartRange = '1y';
let editingId   = null;
let editingType = 'investment';
let editingKpId = null;
let myChart = null;

const PALETTE = ['#4a9eff','#4aff9e','#ff6b6b','#ffcc4a','#c47aff','#ff9f4a','#4affee','#ff4aaa'];

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function chartTheme() {
  return {
    text: cssVar('--text'),
    dim: cssVar('--dim'),
    title: cssVar('--title'),
    border: cssVar('--border'),
    grid: cssVar('--chart-grid'),
    panel: cssVar('--panel'),
    tooltipBg: cssVar('--tooltip-bg')
  };
}

function save() { PortfolioStorage.setJson('ft_accounts', accounts); }
function uid()  { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ─── Formatting ───────────────────────────────────────────────────────────────
function fmt(v) {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  const prefix = v < 0 ? '-$' : '$';
  if (abs >= 1e6)  return prefix + (abs/1e6).toFixed(2) + 'M';
  if (abs >= 1e3)  return prefix + (abs/1e3).toFixed(1) + 'k';
  return prefix + abs.toFixed(2);
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-NZ', { year:'numeric', month:'short', day:'numeric' });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadSamplePortfolio() {
  const today = new Date();
  const Y = today.getFullYear();
  const startDate    = new Date(Y - 2, today.getMonth(), 1).toISOString().slice(0, 10);
  const eventDate1   = new Date(Y - 1, today.getMonth(), 1).toISOString().slice(0, 10);
  const futureDate   = new Date(Y + 1, today.getMonth(), 1).toISOString().slice(0, 10);
  const futureDate2  = new Date(Y + 2, today.getMonth(), 1).toISOString().slice(0, 10);

  accounts = [
    {
      id: uid(), name: 'S&P 500 Index Fund', type: 'investment',
      principal: 25000, startDate, rate: 8, compound: 'monthly',
      term: null, payment: 600, paymentFreq: 12, color: '#4a9eff',
      keypoints: [
        { id: uid(), date: eventDate1, type: 'lump_sum', value: 5000, note: 'Tax refund' },
        { id: uid(), date: futureDate2, type: 'payment_change', value: 800, note: 'Pay rise' }
      ]
    },
    {
      id: uid(), name: 'Home Loan', type: 'loan',
      principal: 420000, startDate, rate: 6.5, compound: 'monthly',
      term: 25, payment: null, paymentFreq: 26, color: '#ff6b6b',
      keypoints: [
        { id: uid(), date: futureDate, type: 'rate_change', value: 5.5, note: 'Refinance', paymentMode: 'auto', newPayment: null },
        { id: uid(), date: futureDate2, type: 'extra_payment', value: 10000, note: 'Bonus to mortgage' }
      ]
    },
    {
      id: uid(), name: 'High-Interest Savings', type: 'investment',
      principal: 12000, startDate, rate: 4.5, compound: 'monthly',
      term: null, payment: 250, paymentFreq: 12, color: '#4aff9e',
      keypoints: []
    },
    {
      id: uid(), name: 'KiwiSaver', type: 'investment',
      principal: 35000, startDate, rate: 7, compound: 'monthly',
      term: null, payment: 400, paymentFreq: 26, color: '#c47aff',
      keypoints: []
    },
    {
      id: uid(), name: 'Car Loan', type: 'loan',
      principal: 28000, startDate, rate: 9, compound: 'monthly',
      term: 5, payment: null, paymentFreq: 26, color: '#ffcc4a',
      keypoints: []
    }
  ];
  save(); renderSidebar(); redraw();
  PortfolioUI.toast('Sample portfolio loaded', { type: 'success' });
}

function requestLoadSample() {
  if (accounts.length === 0) { loadSamplePortfolio(); return; }
  PortfolioUI.confirm('Replace your current portfolio with the sample data? Your existing positions will be lost.',
    { okText: 'Replace', danger: true }).then(ok => { if (ok) loadSamplePortfolio(); });
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('account-list');
  if (accounts.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">💼</div>
        <p>No positions yet.<br>Add a loan or investment to get started.</p>
        <button class="btn-sm" data-action="load-sample" style="margin-top:12px;">Try a sample portfolio</button>
      </div>`;
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  list.innerHTML = accounts.map(acc => {
    const val = calcValue(acc, today, true);
    const effPmt = acc.paymentFreq ? getEffectivePayment(acc) : null;
    const initPmt = acc.payment;
    const pmtChanged = effPmt && initPmt && Math.abs(effPmt - initPmt) > 0.01;
    const pmtTag = effPmt
      ? `<span title="${pmtChanged ? `Initial: ${fmt(initPmt)}` : ''}">${fmt(effPmt)} ${freqLabel(acc.paymentFreq)}${pmtChanged ? ' *' : ''}</span>`
      : '';
    const kpHtml = acc.keypoints.length
      ? `<div class="kp-section">
           <div class="kp-section-title">Events</div>
           ${[...acc.keypoints].sort((a,b)=>a.date.localeCompare(b.date)).map(kp => `
             <div class="kp-item">
               <div class="kp-dot"></div>
               <span>${fmtDate(kp.date)} &mdash; ${escapeHtml(kpLabel(kp, acc.type))}</span>
               <div class="kp-actions">
                 <button class="kp-edit" title="Edit event" data-action="edit-keypoint" data-account-id="${acc.id}" data-keypoint-id="${kp.id}">&#9998;</button>
                 <button class="kp-del"  title="Remove event" data-action="delete-keypoint" data-account-id="${acc.id}" data-keypoint-id="${kp.id}">&#215;</button>
               </div>
             </div>`).join('')}
         </div>` : '';

    return `
      <div class="account-item" data-account-id="${acc.id}">
        <div class="ai-header">
          <div class="ai-dot" style="background:${acc.color}"></div>
          <div class="ai-name" title="${escapeHtml(acc.name)}">${escapeHtml(acc.name)}</div>
          <span class="ai-type ${acc.type}">${acc.type}</span>
        </div>
        <div class="ai-meta">
          <span>From ${fmtDate(acc.startDate)}</span>
          <span>${acc.rate}% p.a.</span>
          ${pmtTag}
        </div>
        <div class="ai-val ${acc.type}">${fmt(val)}</div>
        ${kpHtml}
        <div class="ai-actions">
          <button class="btn-sm" data-action="add-keypoint" data-account-id="${acc.id}">+ Event</button>
          <button class="btn-sm" data-action="edit-account" data-account-id="${acc.id}">Edit</button>
          <button class="btn-sm danger" data-action="delete-account" data-account-id="${acc.id}">Delete</button>
        </div>
      </div>`;
  }).join('');
}

function freqLabel(freq) {
  return freq == 52 ? '/wk' : freq == 26 ? '/fn' : freq == 12 ? '/mo' : freq == 4 ? '/qtr' : '/yr';
}

function kpLabel(kp, accType) {
  const n = kp.note ? ` (${kp.note})` : '';
  if (kp.type === 'rate_change') {
    let base = `Rate → ${kp.value}%`;
    if (kp.paymentMode === 'keep') base += ' · pmt unchanged';
    else if (kp.paymentMode === 'set' && kp.newPayment != null) base += ` · pmt → ${fmt(kp.newPayment)}`;
    return base + n;
  }
  if (kp.type === 'payment_change')  return `Pmt → ${fmt(kp.value)}${n}`;
  if (kp.type === 'extra_payment')   return `${accType === 'investment' ? 'Withdraw' : 'Extra pmt'} ${fmt(kp.value)}${n}`;
  if (kp.type === 'lump_sum')        return `Deposit ${fmt(kp.value)}${n}`;
  return kp.note || 'Note';
}

// ─── Chart ────────────────────────────────────────────────────────────────────
function getRange() {
  const now = new Date();
  // Always start from the earliest account's start date so past data is visible
  const start = accounts.length
    ? new Date(accounts.reduce((m,a) => a.startDate < m ? a.startDate : m, accounts[0].startDate) + 'T00:00:00')
    : new Date(now);
  // End N years *forward* from today — finance tracker projects into the future
  const y = chartRange === 'all' ? 30 : parseInt(chartRange);
  const end = new Date(now.getFullYear() + y, now.getMonth(), now.getDate());
  return { start, end };
}

function buildDates(start, end, extraDates = []) {
  const dates = [], MS_MONTH = 30.4375 * 24 * 3600 * 1000;
  let cur = new Date(start);
  while (cur <= end) { dates.push(cur.toISOString().slice(0,10)); cur = new Date(cur.getTime() + MS_MONTH); }
  const last = end.toISOString().slice(0,10);
  if (dates[dates.length-1] !== last) dates.push(last);
  // Inject keypoint dates so markers land exactly on those points
  const startStr = start.toISOString().slice(0,10), endStr = last;
  for (const d of extraDates) {
    if (d >= startStr && d <= endStr && !dates.includes(d)) dates.push(d);
  }
  dates.sort();
  return dates;
}

function hexRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function redraw() {
  if (myChart) { myChart.destroy(); myChart = null; }
  if (!accounts.length) return;

  const theme = chartTheme();
  const { start, end } = getRange();
  const allKpDates = accounts.flatMap(acc => acc.keypoints.map(k => k.date));
  const dates = buildDates(start, end, allKpDates);
  const datasets = [];

  for (const acc of accounts) {
    const values = dates.map(d => { const v = calcValue(acc,d,true); return v!=null ? +v.toFixed(2) : null; });

    const kpDateSet = new Set(acc.keypoints.map(k => k.date));
    const kpRadii = dates.map(d => kpDateSet.has(d) ? 6 : 0);
    const kpBg    = dates.map(d => kpDateSet.has(d) ? theme.panel : 'transparent');
    const kpHover = dates.map(d => kpDateSet.has(d) ? 8 : 4);

    datasets.push({
      label: acc.name,
      data: values,
      borderColor: acc.color,
      backgroundColor: hexRgba(acc.color, 0.07),
      fill: true,
      borderWidth: 2,
      pointRadius: kpRadii,
      pointHoverRadius: kpHover,
      pointBackgroundColor: kpBg,
      pointBorderColor: acc.color,
      pointBorderWidth: 2,
      tension: 0.35,
      spanGaps: true,
    });

    // Counterfactual dotted line per value-changing event
    const sortedKps = [...acc.keypoints]
      .filter(k => k.type !== 'note')
      .sort((a, b) => a.date.localeCompare(b.date));

    for (let i = 0; i < sortedKps.length; i++) {
      const kp = sortedKps[i];
      const { P, r, segStart, currentPayment } = getPreEventState(acc, sortedKps, i);
      const kpDate = new Date(kp.date + 'T00:00:00');
      const valAtKp = compoundValue(P, r, acc.compound, segStart, kpDate, acc.type, currentPayment, acc.term, acc.paymentFreq);
      const cfData = dates.map(d => {
        if (d < kp.date) return null;
        return +compoundValue(valAtKp, r, acc.compound, kpDate, new Date(d+'T00:00:00'), acc.type, currentPayment, acc.term, acc.paymentFreq).toFixed(2);
      });
      datasets.push({
        label: `${acc.name} — if no "${kpLabel(kp, acc.type)}"`,
        data: cfData,
        borderColor: hexRgba(acc.color, 0.45),
        backgroundColor: 'transparent',
        borderDash: [4, 5],
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.35,
        spanGaps: true,
      });
    }
  }

  const ctx = document.getElementById('chart').getContext('2d');
  myChart = new Chart(ctx, {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: theme.text, font: { size: 12 }, boxWidth: 22, padding: 14 },
        },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          borderColor: theme.border,
          borderWidth: 1,
          titleColor: theme.title,
          bodyColor: theme.text,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}`,
            afterBody: items => {
              if (!items.length) return [];
              const date = dates[items[0].dataIndex];
              // Keypoint notes
              const notes = [];
              for (const acc of accounts) {
                for (const kp of acc.keypoints) {
                  if (kp.date === date) notes.push(`  ⬥ ${acc.name}: ${kpLabel(kp, acc.type)}`);
                }
              }
              // Total: investments add, loans subtract (net worth)
              const mainItems = items.filter(i => !i.dataset.label.includes(' — if no'));
              if (mainItems.length > 1) {
                const total = mainItems.reduce((s, i) => {
                  const acc = accounts.find(a => a.name === i.dataset.label);
                  const sign = acc && acc.type === 'loan' ? -1 : 1;
                  return s + sign * (i.raw || 0);
                }, 0);
                notes.push('', `  Net: ${fmt(total)}`);
              }
              return notes.length ? ['', ...notes] : [];
            }
          }
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'xy',
            threshold: 8,
          },
          zoom: {
            wheel: {
              enabled: true,
              speed: 0.08,
            },
            pinch: {
              enabled: true,
            },
            mode: 'xy',
          },
          limits: {
            x: { min: 'original', max: 'original' },
            y: { min: 'original', max: 'original' },
          }
        }
      },
      scales: {
        x: {
          ticks: { color: theme.dim, maxTicksLimit: 10, font: { size: 11 } },
          grid:  { color: theme.grid },
        },
        y: {
          ticks: { color: theme.dim, font: { size: 11 }, callback: v => fmt(v) },
          grid:  { color: theme.grid },
        }
      }
    }
  });
}

function setRange(range, btn) {
  chartRange = range;
  document.querySelectorAll('#chart-controls .ctrl-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  redraw();
}

function resetChartZoom() {
  if (myChart) myChart.resetZoom();
}

// ─── Account modal ────────────────────────────────────────────────────────────
function openAddAccount() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Add Position';
  document.getElementById('f-name').value = '';
  document.getElementById('f-principal').value = '';
  document.getElementById('f-startdate').value = new Date().toISOString().slice(0,10);
  document.getElementById('f-rate').value = '';
  document.getElementById('f-compound').value = 'monthly';
  document.getElementById('f-term').value = '';
  document.getElementById('f-payment').value = '';
  document.getElementById('f-payment-freq').value = '12';
  document.getElementById('f-color').value = PALETTE[accounts.length % PALETTE.length];
  selectType('investment', document.querySelector('.type-tab[data-type="investment"]'));
  openModal('account-modal');
}

function editAccount(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  editingId = id;
  document.getElementById('modal-title').textContent = 'Edit Position';
  document.getElementById('f-name').value = acc.name;
  document.getElementById('f-principal').value = acc.principal;
  document.getElementById('f-startdate').value = acc.startDate;
  document.getElementById('f-rate').value = acc.rate;
  document.getElementById('f-compound').value = acc.compound;
  document.getElementById('f-term').value = acc.term || '';
  document.getElementById('f-payment').value = acc.payment || '';
  document.getElementById('f-payment-freq').value = acc.paymentFreq || '';
  document.getElementById('f-color').value = acc.color;
  selectType(acc.type, document.querySelector(`.type-tab[data-type="${acc.type}"]`));
  openModal('account-modal');
}

function saveAccount() {
  const name        = document.getElementById('f-name').value.trim();
  const principal   = parseFloat(document.getElementById('f-principal').value);
  const startDate   = document.getElementById('f-startdate').value;
  const rate        = parseFloat(document.getElementById('f-rate').value);
  const compound    = document.getElementById('f-compound').value;
  const termRaw     = document.getElementById('f-term').value.trim();
  const paymentRaw  = document.getElementById('f-payment').value.trim();
  const term        = termRaw    === '' ? null : parseFloat(termRaw);
  const payment     = paymentRaw === '' ? null : parseFloat(paymentRaw);
  const paymentFreq = parseInt(document.getElementById('f-payment-freq').value) || null;
  const color       = document.getElementById('f-color').value;

  if (!name || isNaN(principal) || !startDate || isNaN(rate)) {
    PortfolioUI.toast('Please fill in Name, Value, Start Date, and Rate.', { type: 'error' });
    return;
  }
  if (rate < 0) {
    PortfolioUI.toast('Interest rate cannot be negative.', { type: 'error' });
    return;
  }

  const isEditing = !!editingId;
  if (isEditing) {
    Object.assign(accounts.find(a => a.id === editingId), { name, principal, startDate, rate, compound, term, payment, paymentFreq, color, type: editingType });
  } else {
    accounts.push({ id: uid(), name, type: editingType, principal, startDate, rate, compound, term, payment, paymentFreq, color, keypoints: [] });
  }

  save(); closeModal('account-modal'); renderSidebar(); redraw();
  PortfolioUI.toast(isEditing ? 'Position updated' : 'Position added', { type: 'success' });
}

function deleteAccount(id) {
  PortfolioUI.confirm('Delete this position and all its events? This cannot be undone.',
    { okText: 'Delete', danger: true }).then(ok => {
    if (!ok) return;
    accounts = accounts.filter(a => a.id !== id);
    save(); renderSidebar(); redraw();
    PortfolioUI.toast('Position deleted', { type: 'success' });
  });
}

function selectType(type, btn) {
  editingType = type;
  document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('loan-only-fields').style.display        = type === 'loan' ? '' : 'none';
  document.getElementById('f-principal-label').textContent         = type === 'loan' ? 'Loan Amount ($)' : 'Starting Value ($)';
  document.getElementById('f-payment-label').textContent           = type === 'loan' ? 'Regular Repayment ($)' : 'Regular Contribution ($)';
  document.getElementById('f-payment-hint').textContent            = type === 'loan' ? 'Leave blank to auto-calculate' : 'Leave blank for no contributions';
  document.getElementById('f-payment').placeholder                 = type === 'loan' ? 'auto-calc' : '0.00';
}

// ─── Keypoint modal ───────────────────────────────────────────────────────────
function openAddKeypoint(accId) {
  editingKpId = null;
  document.getElementById('kp-acc-id').value        = accId;
  document.getElementById('kp-date').value          = new Date().toISOString().slice(0,10);
  document.getElementById('kp-type').value          = 'rate_change';
  document.getElementById('kp-value').value         = '';
  document.getElementById('kp-note').value          = '';
  document.getElementById('kp-payment-mode').value  = 'auto';
  document.getElementById('kp-new-payment').value   = '';
  document.querySelector('#keypoint-modal h2').textContent = 'Add Event';
  document.getElementById('kp-save-btn').textContent = 'Add Event';
  onKpTypeChange();
  openModal('keypoint-modal');
}

function editKeypoint(accId, kpId) {
  const acc = accounts.find(a => a.id === accId);
  const kp  = acc && acc.keypoints.find(k => k.id === kpId);
  if (!kp) return;
  editingKpId = kpId;
  document.getElementById('kp-acc-id').value        = accId;
  document.getElementById('kp-date').value          = kp.date;
  document.getElementById('kp-type').value          = kp.type;
  document.getElementById('kp-value').value         = kp.value || '';
  document.getElementById('kp-note').value          = kp.note || '';
  document.getElementById('kp-payment-mode').value  = kp.paymentMode || 'auto';
  document.getElementById('kp-new-payment').value   = kp.newPayment || '';
  document.querySelector('#keypoint-modal h2').textContent = 'Edit Event';
  document.getElementById('kp-save-btn').textContent = 'Save Changes';
  onKpTypeChange();
  openModal('keypoint-modal');
}

function onKpTypeChange() {
  const type  = document.getElementById('kp-type').value;
  const accId = document.getElementById('kp-acc-id').value;
  const acc   = accounts.find(a => a.id === accId);
  const row   = document.getElementById('kp-value-row');
  const lbl   = document.getElementById('kp-value-label');
  const pmRow = document.getElementById('kp-payment-mode-row');

  if (type === 'note') {
    row.style.display = 'none';
    pmRow.style.display = 'none';
    document.getElementById('kp-new-payment-row').style.display = 'none';
    return;
  }
  row.style.display = '';
  lbl.textContent =
    type === 'rate_change'    ? 'New Rate (% p.a.)' :
    type === 'payment_change' ? (acc && acc.type === 'loan' ? 'New Repayment Amount ($)' : 'New Contribution Amount ($)') :
    type === 'extra_payment'  ? 'Payment / Withdrawal Amount ($)' :
                                'Deposit Amount ($)';
  // Repayment mode only for rate changes on loans
  const showPmMode = type === 'rate_change' && acc && acc.type === 'loan';
  pmRow.style.display = showPmMode ? '' : 'none';
  if (!showPmMode) document.getElementById('kp-new-payment-row').style.display = 'none';
  else onKpPaymentModeChange();
}

function onKpPaymentModeChange() {
  const mode = document.getElementById('kp-payment-mode').value;
  document.getElementById('kp-new-payment-row').style.display = mode === 'set' ? '' : 'none';
}

function saveKeypoint() {
  const accId       = document.getElementById('kp-acc-id').value;
  const date        = document.getElementById('kp-date').value;
  const type        = document.getElementById('kp-type').value;
  const valueRaw    = document.getElementById('kp-value').value.trim();
  const value       = valueRaw === '' ? null : parseFloat(valueRaw);
  const note        = document.getElementById('kp-note').value.trim();
  const paymentMode = document.getElementById('kp-payment-mode').value;
  const newPayRaw   = document.getElementById('kp-new-payment').value.trim();
  const newPayment  = newPayRaw === '' ? null : parseFloat(newPayRaw);
  if (!date) { PortfolioUI.toast('Please select a date.', { type: 'error' }); return; }
  if (type !== 'note' && (value == null || isNaN(value))) {
    PortfolioUI.toast('Please enter a value.', { type: 'error' }); return;
  }

  const acc = accounts.find(a => a.id === accId);
  if (!acc) return;

  const data = { date, type, value: value || 0, note,
    ...(type === 'rate_change' && acc.type === 'loan' ? { paymentMode, newPayment } : {}) };

  const isEditing = !!editingKpId;
  if (isEditing) {
    const kp = acc.keypoints.find(k => k.id === editingKpId);
    if (kp) Object.assign(kp, data);
  } else {
    acc.keypoints.push({ id: uid(), ...data });
  }
  editingKpId = null;
  save(); closeModal('keypoint-modal'); renderSidebar(); redraw();
  PortfolioUI.toast(isEditing ? 'Event updated' : 'Event added', { type: 'success' });
}

function deleteKeypoint(accId, kpId) {
  PortfolioUI.confirm('Remove this event?', { okText: 'Remove', danger: true }).then(ok => {
    if (!ok) return;
    const acc = accounts.find(a => a.id === accId);
    if (!acc) return;
    acc.keypoints = acc.keypoints.filter(k => k.id !== kpId);
    save(); renderSidebar(); redraw();
    PortfolioUI.toast('Event removed', { type: 'success' });
  });
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-overlay').forEach(el =>
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); })
);

function bindFinanceEvents() {
  document.getElementById('btn-add-account').addEventListener('click', openAddAccount);
  document.getElementById('btn-load-sample').addEventListener('click', requestLoadSample);
  document.getElementById('btn-reset-zoom').addEventListener('click', resetChartZoom);
  document.getElementById('btn-save-account').addEventListener('click', saveAccount);
  document.getElementById('kp-save-btn').addEventListener('click', saveKeypoint);
  document.getElementById('kp-type').addEventListener('change', onKpTypeChange);
  document.getElementById('kp-payment-mode').addEventListener('change', onKpPaymentModeChange);

  document.querySelectorAll('[data-close-modal]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal))
  );
  document.querySelectorAll('[data-range]').forEach(btn =>
    btn.addEventListener('click', () => setRange(btn.dataset.range, btn))
  );
  document.querySelectorAll('.type-tab').forEach(btn =>
    btn.addEventListener('click', () => selectType(btn.dataset.type, btn))
  );

  document.getElementById('account-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();
    const accountId = btn.dataset.accountId;
    if (btn.dataset.action === 'add-keypoint') openAddKeypoint(accountId);
    if (btn.dataset.action === 'edit-account') editAccount(accountId);
    if (btn.dataset.action === 'delete-account') deleteAccount(accountId);
    if (btn.dataset.action === 'edit-keypoint') editKeypoint(accountId, btn.dataset.keypointId);
    if (btn.dataset.action === 'delete-keypoint') deleteKeypoint(accountId, btn.dataset.keypointId);
    if (btn.dataset.action === 'load-sample') loadSamplePortfolio();
  });

  // Esc closes any open modal
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.modal-overlay.open');
    if (open) { e.preventDefault(); open.classList.remove('open'); }
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
bindFinanceEvents();
renderSidebar();
PortfolioTheme.init({ onChange: () => { if (myChart) redraw(); } });
redraw();
