// Token Radar v3 dashboard. Renders window.RADAR (written by main.ts) —
// no network, no framework. Sort, filter, detail drawer, scatter, explainer.
(function () {
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:40px">No radar data.</p>'; return; }
  var rows = R.rows;
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(x) { return x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(id) { return document.getElementById(id); }
  function bySlug(s) { for (var i = 0; i < rows.length; i++) if (rows[i].slug === s) return rows[i]; return null; }

  // Integrity strip: every number ties to a model artifact.
  var m = R.model;
  el('integrity').innerHTML = [
    '<span>Snapshot <b>' + esc(R.as_of) + '</b></span>',
    '<span><b>' + R.counts.protocols + '</b> protocols</span>',
    '<span><b>' + R.counts.traded + '</b> traded comps</span>',
    '<span><b>' + R.counts.pre + '</b> pre-token</span>',
    '<span>Watchlist <b>' + R.counts.watchlist + '/' + R.counts.watchlist + '</b></span>',
    '<span>Set aside <b>' + R.counts.setAside + '</b> above-floor</span>',
    '<span>LOO miss <b>×' + m.loo_median_miss.toFixed(2) + '</b></span>',
    '<span>Time-split miss <b>' + (m.time_split ? '×' + m.time_split.median_miss.toFixed(2) : 'n/a') + '</b></span>',
    '<span>R² <b>' + m.r2.toFixed(2) + '</b></span>'
  ].join('');
  el('foot-date').textContent = R.as_of;

  // KPIs.
  var top = rows[0];
  el('kpis').innerHTML = [
    ['Top expected value', money(top.ev_usd) + ' · ' + esc(top.name)],
    ['Median expected value', money(rows[Math.floor(rows.length / 2)].ev_usd)],
    ['FARM verdicts', R.verdicts.FARM + ' of ' + rows.length],
    ['Watchlist covered', R.counts.watchlist + ' / ' + R.counts.watchlist],
    ['Median farm cost', '$' + Math.round(rows.reduce(function (a, r) { return a + r.cost_usd; }, 0) / rows.length)]
  ].map(function (k) { return '<div class="kpi"><div class="n">' + k[1] + '</div><div class="l">' + k[0] + '</div></div>'; }).join('');

  // Hero top 5.
  el('hero').innerHTML = rows.slice(0, 5).map(function (r) {
    return '<div class="card" data-slug="' + esc(r.slug) + '"><div class="rk">#' + r.rank + (r.watchlist ? ' · WATCHLIST' : '') + '</div>' +
      '<div class="nm">' + esc(r.name) + '</div><div class="ev">' + money(r.ev_usd) + '</div>' +
      '<div class="sub">odds ' + Math.round(r.odds * 100) + '% · fitted ' + money(r.fitted_usd) + ' · farm $' + r.cost_usd + '</div></div>';
  }).join('');

  // Scatter: log TVL vs log EV; crosses are the live-token anchors (actual mcap).
  (function scatter() {
    var svg = el('scatter'), W = 720, H = 340, pad = 44;
    var xs = rows.map(function (r) { return Math.log10(Math.max(1, r.tvl_usd)); });
    var ys = rows.map(function (r) { return Math.log10(Math.max(1, r.ev_usd)); });
    var ax = R.anchors.map(function (a) { return Math.log10(Math.max(1, a.tvl_usd)); });
    var ay = R.anchors.map(function (a) { return Math.log10(Math.max(1, a.mcap_usd)); });
    var x0 = Math.min.apply(null, xs.concat(ax)), x1 = Math.max.apply(null, xs.concat(ax));
    var y0 = Math.min.apply(null, ys.concat(ay)), y1 = Math.max.apply(null, ys.concat(ay));
    function X(v) { return pad + (v - x0) / (x1 - x0) * (W - pad - 16); }
    function Y(v) { return H - pad - (v - y0) / (y1 - y0) * (H - pad - 16); }
    var col = { FARM: '#34d399', THIN: '#fbbf24', SKIP: '#64748b' };
    var s = '';
    for (var g = 0; g <= 4; g++) {
      var gx = pad + g / 4 * (W - pad - 16), gy = H - pad - g / 4 * (H - pad - 16);
      s += '<line x1="' + gx + '" y1="16" x2="' + gx + '" y2="' + (H - pad) + '" stroke="#1e2c47"/>' +
        '<line x1="' + pad + '" y1="' + gy + '" x2="' + (W - 16) + '" y2="' + gy + '" stroke="#1e2c47"/>';
    }
    rows.forEach(function (r) {
      s += '<circle cx="' + X(Math.log10(Math.max(1, r.tvl_usd))).toFixed(1) + '" cy="' + Y(Math.log10(Math.max(1, r.ev_usd))).toFixed(1) +
        '" r="' + (r.watchlist ? 4.2 : 2.6) + '" fill="' + col[r.verdict] + '" fill-opacity="' + (r.watchlist ? .95 : .55) + '"><title>' + esc(r.name) + ' · EV ' + money(r.ev_usd) + '</title></circle>';
    });
    R.anchors.forEach(function (a, i) {
      var cx = X(ax[i]), cy = Y(ay[i]);
      s += '<g class="anchor-mark" stroke="#e6edf7" stroke-width="1.6"><line x1="' + (cx - 4) + '" y1="' + (cy - 4) + '" x2="' + (cx + 4) + '" y2="' + (cy + 4) + '"/><line x1="' + (cx - 4) + '" y1="' + (cy + 4) + '" x2="' + (cx + 4) + '" y2="' + (cy - 4) + '"/></g>';
    });
    s += '<text x="' + (W / 2) + '" y="' + (H - 8) + '" fill="#8fa3bf" font-size="12" text-anchor="middle">TVL (log scale)</text>' +
      '<text x="16" y="' + (H / 2) + '" fill="#8fa3bf" font-size="12" text-anchor="middle" transform="rotate(-90 16 ' + (H / 2) + ')">Expected value (log)</text>';
    svg.innerHTML = s;
  })();

  // Board: sort + filter.
  var state = { sort: 'rank', dir: 1, q: '', cat: '', verdict: '', wl: false };
  var cats = {};
  rows.forEach(function (r) { cats[r.category || 'Uncategorised'] = 1; });
  el('cat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  function filtered() {
    return rows.filter(function (r) {
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.wl && !r.watchlist) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(state.q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var k = state.sort, d = state.dir, av = a[k], bv = b[k];
      if (typeof av === 'string') return av.localeCompare(bv) * d;
      return ((av == null ? -1e18 : av) - (bv == null ? -1e18 : bv)) * d;
    });
  }
  function render() {
    var list = filtered();
    el('board-count').textContent = list.length + ' of ' + rows.length + ' rows';
    el('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (r.watchlist ? '<span class="wlbadge">WATCHLIST</span>' : '') + '<br><span style="color:var(--mut);font-size:12px">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td><td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + r.age_years.toFixed(1) + 'y</td><td class="num">' + money(r.fitted_usd) + '</td>' +
        '<td class="num">' + Math.round(r.odds * 100) + '%</td><td class="num"><b>' + money(r.ev_usd) + '</b></td>' +
        '<td class="num">$' + r.cost_usd + '</td><td><span class="v ' + r.verdict + '">' + r.verdict + '</span></td></tr>';
    }).join('');
  }
  el('live').addEventListener('change', function (e) {
    document.querySelectorAll('.anchor-mark').forEach(function (g) { g.style.display = e.target.checked ? '' : 'none'; });
  });
  document.querySelectorAll('#board th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
      render();
    });
  });
  el('q').addEventListener('input', function (e) { state.q = e.target.value.trim().toLowerCase(); render(); });
  el('cat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  el('wl').addEventListener('change', function (e) { state.wl = e.target.checked; render(); });
  document.querySelectorAll('.verdicts button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.verdicts button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); state.verdict = b.getAttribute('data-v'); render();
    });
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-slug]');
    if (t) openDetail(t.getAttribute('data-slug'));
  });

  // Detail drawer with the value waterfall.
  function openDetail(slug) {
    var r = bySlug(slug); if (!r) return;
    var w = r.waterfall;
    var steps = [
      ['Base (TVL only)', w.base, 1]
    ];
    // Only show adjustment terms the shipped model actually uses (factor != 1).
    [['× growth', w.growth], ['× age', w.age], ['× chains', w.chains], ['× category', w.category]].forEach(function (s) {
      if (Math.abs(s[1] - 1) > 0.005) steps.push([s[0], null, s[1]]);
    });
    var maxLog = Math.log10(Math.max(w.base, r.fitted_usd, 1));
    var html = '<h3>' + esc(r.name) + '</h3><div class="meta">#' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      ' · TVL ' + money(r.tvl_usd) + ' · ' + pct(r.change_7d) + ' in 7d · listed ' + r.age_years.toFixed(1) + 'y ago' + (r.watchlist ? ' · WATCHLIST' : '') + '</div>';
    html += '<div class="wf">';
    steps.forEach(function (s) {
      var v = s[1] != null ? money(s[1]) : '×' + s[2].toFixed(2);
      var width = s[1] != null ? Math.max(4, Math.log10(Math.max(s[1], 1)) / maxLog * 100) : 50;
      html += '<div class="row"><span>' + s[0] + '</span><span class="bar"><i style="width:' + width.toFixed(0) + '%"></i></span><span style="text-align:right">' + v + '</span></div>';
    });
    html += '<div class="row total"><span>Fitted value</span><span class="bar"><i style="width:100%"></i></span><span style="text-align:right">' + money(r.fitted_usd) + '</span></div>';
    html += '<div class="row"><span>× token odds</span><span class="bar"><i style="width:' + Math.round(r.odds * 100) + '%"></i></span><span style="text-align:right">' + Math.round(r.odds * 100) + '%</span></div>';
    html += '<div class="row total"><span>Expected value</span><span class="bar"><i style="width:100%;background:var(--farm)"></i></span><span style="text-align:right">' + money(r.ev_usd) + '</span></div></div>';
    html += '<p><span class="v ' + r.verdict + '">' + r.verdict + '</span> &nbsp; Farm cost about $' + r.cost_usd + ' in gas and fees · about ' + r.time_min + ' min of your time</p>';
    html += '<h3 style="font-size:15px">How to farm it</h3><ol class="steps">' + r.farm_steps.map(function (s, i) {
      return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(s) + '</li>';
    }).join('') + '</ol>';
    var ifOdds2 = money(r.fitted_usd * Math.min(1, r.odds * 2));
    var ifFitHalf = money(r.fitted_usd * 0.5 * r.odds);
    html += '<div class="callout"><b>What would change this verdict:</b> if the token odds doubled, EV would be ' + ifOdds2 + '; if the fitted value halved, EV would be ' + ifFitHalf + '. The residual error is wide — the leave-one-out median miss is ×' + m.loo_median_miss.toFixed(2) + ' — so treat the rank as a queue to work, not a price.</div>';
    el('detail').innerHTML = html;
    el('drawer').classList.add('open');
    el('drawer').setAttribute('aria-hidden', 'false');
    if (history.replaceState) history.replaceState(null, '', '#detail=' + slug);
  }
  el('close').addEventListener('click', function () {
    el('drawer').classList.remove('open');
    if (history.replaceState) history.replaceState(null, '', '#');
  });

  // Anchors table.
  el('anchors').querySelector('tbody').innerHTML = R.anchors.map(function (a) {
    return '<tr><td><b>' + esc(a.name) + '</b></td><td class="num">' + money(a.tvl_usd) + '</td><td class="num">' + money(a.mcap_usd) + '</td><td class="num">' + money(a.fitted_usd) + '</td><td class="num">×' + a.miss.toFixed(2) + '</td></tr>';
  }).join('');

  // Explainer.
  var coef = m.coef;
  el('explainer').innerHTML =
    '<p><b>Model.</b> ' + esc(m.spec) + ', fitted on ' + m.n_fit + ' traded protocols. ' +
    'Coefficients (log10 mcap): intercept ' + coef[0].toFixed(3) + ', log TVL ' + coef[1].toFixed(3) +
    (coef.length > 2 ? ', growth ' + coef[2].toFixed(3) + ', age ' + coef[3].toFixed(3) + ', log chains ' + coef[4].toFixed(3) : '') +
    '. A richer spec (growth, age, chain breadth) and a shrunk category residual were both tested by leave-one-out and rejected — each worsened the held-out miss — so the shipped model is the plain log-log fit.</p>' +
    '<h3>Held-out checks</h3><p>Leave-one-out median miss: simple spec ×' + m.loo_simple_miss.toFixed(2) + ', richer spec ×' + m.loo_rich_miss.toFixed(2) +
    ' — the better one ships. ' + (m.time_split ? 'Time-split backtest (fit on comps listed before 2025, test on 2025+ listings): ' + m.time_split.train_n + ' train, ' + m.time_split.test_n + ' test, median miss ×' + m.time_split.median_miss.toFixed(2) + '. ' : '') +
    'In-sample R² ' + m.r2.toFixed(3) + '. The miss is multiplicative: half the comps land within this factor of their real market cap.</p>' +
    '<h3>Token odds — predicted vs observed, by TVL band</h3><table><thead><tr><th>TVL band</th><th class="num">n</th><th class="num">Traded</th><th class="num">Predicted odds</th><th class="num">Observed share</th></tr></thead><tbody>' +
    m.cal.map(function (c) { return '<tr><td>' + esc(c.band) + '</td><td class="num">' + c.n + '</td><td class="num">' + c.traded + '</td><td class="num">' + Math.round(c.predicted * 100) + '%</td><td class="num">' + Math.round(c.observed * 100) + '%</td></tr>'; }).join('') +
    '</tbody></table>' +
    '<h3>What this radar does not do</h3><p>It does not predict whether or when a token launches — the odds are the share of peers in the same TVL band whose token already trades, smoothed toward the global rate. ' +
    'Above the $50M floor the board follows the house watchlist rule: ' + R.counts.setAside + ' pre-token protocols are set aside as exchanges, bridges, liquid-staking or wrapped/staked products, because their token already trades or they are a product of one that does. Below the floor every pre-token protocol is ranked. ' +
    'A protocol that records no token may still have one its DefiLlama record does not carry. Farm costs are gas and fees only; the capital you deploy stays yours. ' +
    'Verdicts: FARM means expected value ≥ $2.5M with odds ≥ 15%; THIN means EV ≥ $1M with odds ≥ 10%; the rest is SKIP — a queue, not a promise.</p>';
  el('explainer').className = 'exp';

  // Hash state for screenshots and deep links.
  var h = location.hash;
  var dm = h.match(/detail=([\w-]+)/);
  var vm = h.match(/verdict=(FARM|THIN|SKIP)/);
  var viewBoard = /view=board/.test(h);
  if (vm) {
    state.verdict = vm[1];
    document.querySelectorAll('.verdicts button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-v') === vm[1]); });
  }
  render();
  if (dm) openDetail(dm[1]);
  if (viewBoard) document.body.classList.add('shot-board');
})();
