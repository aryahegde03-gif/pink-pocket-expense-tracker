/* ── Bloom Expense Tracker — Frontend Logic ── */

const PINK = {
  primary:  '#eb2f96',
  light:    '#ff85be',
  lighter:  '#ffadd2',
  lightest: '#ffd6e8',
  blush:    '#ffe4ef',
  palette: [
    '#eb2f96','#f759ab','#ff85be','#ffa8d0',
    '#c41d7f','#ff4d8d','#ffadd2','#d63384'
  ]
};

/* ── Navigation ──────────────────────────── */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.section);
    target.classList.add('active');

    if (btn.dataset.section === 'dashboard')  loadDashboard();
    if (btn.dataset.section === 'expenses')   loadExpenses();
    if (btn.dataset.section === 'analytics')  loadAnalytics();
  });
});

/* ── Set today's date as default ─────────── */
document.getElementById('date').valueAsDate = new Date();

/* ── Helpers ─────────────────────────────── */
const fmt = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function showMsg(type, text) {
  const el = document.getElementById('form-msg');
  el.textContent = text;
  el.className = 'form-msg ' + type;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

/* ── Add Expense ─────────────────────────── */
document.getElementById('addBtn').addEventListener('click', async () => {
  const amount      = document.getElementById('amount').value;
  const category    = document.getElementById('category').value;
  const description = document.getElementById('description').value;
  const date        = document.getElementById('date').value;

  if (!amount || !category || !date) {
    showMsg('error', 'Please fill in amount, category, and date.'); return;
  }

  try {
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: parseFloat(amount), category, description, date })
    });
    const data = await res.json();
    if (!res.ok) { showMsg('error', data.error || 'Something went wrong.'); return; }

    showMsg('success', '✓ Expense added successfully!');
    document.getElementById('amount').value = '';
    document.getElementById('description').value = '';
    document.getElementById('category').value = '';
    document.getElementById('date').valueAsDate = new Date();
  } catch (e) {
    showMsg('error', 'Network error. Is the server running?');
  }
});

/* ── Load Dashboard ──────────────────────── */
async function loadDashboard() {
  try {
    const [overviewRes, catRes, expRes] = await Promise.all([
      fetch('/api/summary/overview'),
      fetch('/api/summary/category'),
      fetch('/api/expenses')
    ]);
    const overview  = await overviewRes.json();
    const catData   = await catRes.json();
    const expenses  = await expRes.json();

    document.getElementById('kpi-total').textContent = fmt(overview.total_spent);
    document.getElementById('kpi-month').textContent = fmt(overview.current_month_total);
    document.getElementById('kpi-avg').textContent   = fmt(overview.average_expense);
    document.getElementById('kpi-top').textContent   = overview.top_category || '—';

    // Recent list (last 6)
    const list = document.getElementById('recent-list');
    const recent = expenses.slice(0, 6);
    if (recent.length === 0) {
      list.innerHTML = '<li class="empty-state">No expenses yet.</li>';
    } else {
      list.innerHTML = recent.map(e => `
        <li>
          <span class="recent-cat">${e.category}</span>
          <span class="recent-desc">${e.description || '—'}</span>
          <span class="recent-amt">${fmt(e.amount)}</span>
        </li>
      `).join('');
    }

    // Mini Pie
    renderMiniPie(catData);
  } catch(err) { console.error('Dashboard load error:', err); }
}

/* ── Mini Pie Chart ──────────────────────── */
let miniPieInstance = null;
function renderMiniPie(catData) {
  const canvas = document.getElementById('miniPieChart');
  const empty  = document.getElementById('mini-empty');
  if (!catData || catData.length === 0) {
    canvas.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  canvas.classList.remove('hidden');
  empty.classList.add('hidden');

  if (miniPieInstance) miniPieInstance.destroy();
  miniPieInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: catData.map(d => d.category),
      datasets: [{
        data: catData.map(d => d.total),
        backgroundColor: PINK.palette.slice(0, catData.length),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'DM Sans', size: 11 }, color: '#8b6a7a', boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)}` } }
      }
    }
  });
}

/* ── Load All Expenses ───────────────────── */
async function loadExpenses(category = '', search = '') {
  try {
    let url = '/api/expenses';
    if (category) url += `?category=${encodeURIComponent(category)}`;
    const res  = await fetch(url);
    let data = await res.json();

    if (search) {
      const q = search.toLowerCase();
      data = data.filter(e => (e.description || '').toLowerCase().includes(q));
    }

    const tbody = document.getElementById('expense-tbody');
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No expenses found.</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(e => `
      <tr>
        <td>${e.date}</td>
        <td><span class="cat-pill">${e.category}</span></td>
        <td>${e.description || '—'}</td>
        <td class="amount-cell">${fmt(e.amount)}</td>
        <td><button class="btn-delete" onclick="deleteExpense(${e.id})">Delete</button></td>
      </tr>
    `).join('');
  } catch(err) { console.error('Expenses load error:', err); }
}

document.getElementById('filterBtn').addEventListener('click', () => {
  loadExpenses(
    document.getElementById('filter-cat').value,
    document.getElementById('search').value
  );
});

document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('filter-cat').value = '';
  document.getElementById('search').value = '';
  loadExpenses();
});

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  try {
    const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
    if (res.ok) loadExpenses();
    else alert('Could not delete expense.');
  } catch(e) { alert('Network error.'); }
}

/* ── Analytics ───────────────────────────── */
let monthlyChart = null;
let categoryChart = null;

async function loadAnalytics() {
  try {
    const [monthRes, catRes] = await Promise.all([
      fetch('/api/summary/monthly'),
      fetch('/api/summary/category')
    ]);
    const monthData = await monthRes.json();
    const catData   = await catRes.json();

    renderMonthlyChart(monthData);
    renderCategoryChart(catData);
    renderBreakdown(catData);
  } catch(err) { console.error('Analytics load error:', err); }
}

function renderMonthlyChart(data) {
  const canvas = document.getElementById('monthlyChart');
  if (monthlyChart) monthlyChart.destroy();

  const labels = data.map(d => {
    const [y, m] = d.month.split('-');
    return new Date(y, m - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
  });

  monthlyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total Spent',
        data: data.map(d => d.total),
        backgroundColor: PINK.lightest,
        borderColor: PINK.primary,
        borderWidth: 2,
        borderRadius: 8,
        hoverBackgroundColor: PINK.lighter
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8b6a7a', font: { family: 'DM Sans' } } },
        y: { grid: { color: '#f0d6e4' }, ticks: { color: '#8b6a7a', font: { family: 'DM Sans' }, callback: v => '₹' + v.toLocaleString('en-IN') } }
      }
    }
  });
}

function renderCategoryChart(data) {
  const canvas = document.getElementById('categoryChart');
  if (categoryChart) categoryChart.destroy();

  if (!data || data.length === 0) {
    canvas.parentElement.innerHTML += '<p class="empty-state">No data yet.</p>';
    return;
  }

  categoryChart = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: data.map(d => d.category),
      datasets: [{
        data: data.map(d => d.total),
        backgroundColor: PINK.palette.slice(0, data.length),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'DM Sans', size: 11 }, color: '#8b6a7a', boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)} (${data[ctx.dataIndex].percentage}%)` } }
      }
    }
  });
}

function renderBreakdown(data) {
  const el = document.getElementById('cat-breakdown');
  if (!data || data.length === 0) {
    el.innerHTML = '<p class="empty-state">No data yet.</p>'; return;
  }
  el.innerHTML = data.map((d, i) => `
    <div class="cat-row">
      <span class="cat-row-name">${d.category}</span>
      <div class="cat-bar-wrap">
        <div class="cat-bar" style="width:${d.percentage}%; background: ${PINK.palette[i % PINK.palette.length]}"></div>
      </div>
      <span class="cat-row-pct">${d.percentage}%</span>
    </div>
  `).join('');
}

/* ── Init ────────────────────────────────── */
loadDashboard();

(function () {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position:      'fixed',
    top:           '0',
    left:          '0',
    width:         '100%',
    height:        '100%',
    pointerEvents: 'none',
    zIndex:        '99999'
  });
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  // Config — tweak these to match your taste
  const SPARK_COLOR  = '#eb2f96';   // pink to match the theme
  const SPARK_COUNT  = 8;
  const SPARK_SIZE   = 10;
  const SPARK_RADIUS = 20;
  const DURATION     = 450;         // ms

  let sparks = [];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function easeOut(t) { return t * (2 - t); }

  function draw(timestamp) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    sparks = sparks.filter(spark => {
      const elapsed  = timestamp - spark.startTime;
      if (elapsed >= DURATION) return false;

      const progress = elapsed / DURATION;
      const eased    = easeOut(progress);
      const distance = eased * SPARK_RADIUS;
      const lineLen  = SPARK_SIZE * (1 - eased);

      const x1 = spark.x + distance * Math.cos(spark.angle);
      const y1 = spark.y + distance * Math.sin(spark.angle);
      const x2 = spark.x + (distance + lineLen) * Math.cos(spark.angle);
      const y2 = spark.y + (distance + lineLen) * Math.sin(spark.angle);

      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = SPARK_COLOR;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      return true;
    });

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  document.addEventListener('click', e => {
    const now = performance.now();
    for (let i = 0; i < SPARK_COUNT; i++) {
      sparks.push({
        x:         e.clientX,
        y:         e.clientY,
        angle:     (2 * Math.PI * i) / SPARK_COUNT,
        startTime: now
      });
    }
  });
})();
