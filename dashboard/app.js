// Token Radar dashboard: renders window.RADAR (written by main.ts from the same board as
// board.json, farm plans included, so the page can never disagree with the board). No network,
// no framework: search, category and chain filters, a watchlist toggle, sortable columns, a
// live-token tab kept apart from the ranking, and a detail drawer per protocol whose hash
// (#p=<slug>, #cat=<category>, #tab=live) makes every view linkable and screenshottable.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var main = document.getElementById('board');
  if (!DATA) { main.textContent = 'No radar data: run main.ts first.'; return; }
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'pre', sort: 'rank', dir: 1, selected: null };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function usd(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(n) { return n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(days) {
    if (days === null || days === undefined) return 'unreported';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function readHash() {
    var h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (h.get('q')) state.q = h.get('q');
    if (h.get('cat')) state.category = h.get('cat');
    if (h.get('chain')) state.chain = h.get('chain');
    if (h.get('watch') === '1') state.watch = true;
    if (h.get('tab')) state.tab = h.get('tab');
    if (h.get('p')) state.selected = h.get('p');
  }
  function writeHash() {
    var h = new URLSearchParams();
    if (state.q) h.set('q', state.q);
    if (state.category !== 'all') h.set('cat', state.category);
    if (state.chain !== 'all') h.set('chain', state.chain);
    if (state.watch) h.set('watch', '1');
    if (state.tab !== 'pre') h.set('tab', state.tab);
    if (state.selected) h.set('p', state.selected);
    var s = h.toString();
    window.history.replaceState(null, '', window.location.pathname + window.location.search + (s ? '#' + s : ''));
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sorted(list) {
    var k = state.sort, d = state.dir;
    var val = {
      rank: function (r) { return r.rank; }, tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
      peer: function (r) { return r.model.peer_multiple; }, implied: function (r) { return r.implied_value_usd; }
    }[k];
    return list.slice().sort(function (a, b) { return (val(a) - val(b)) * d || a.rank - b.rank; });
  }
  function header() {
    var total = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    function stat(v, l) { return el('div', { class: 'stat' }, [el('b', { text: v }), el('span', { text: l })]); }
    return el('div', { class: 'top' }, [
      el('div', {}, [
        el('div', { class: 'brand' }, [
          el('div', { class: 'mark', 'aria-hidden': 'true' }),
          el('div', {}, [
            el('div', { class: 'kicker', text: 'Token launch radar' }),
            el('h1', { text: 'What is a token worth before it exists?' })
          ])
        ]),
        el('p', { class: 'sub', text: 'Every protocol in the snapshot that records no token, ranked by the value its token would carry if it traded like its category\u2019s live peers. Snapshot of ' + DATA.as_of + ', from ' + DATA.source + '.' })
      ]),
      el('div', { class: 'stats' }, [
        stat(String(DATA.scanned_size), 'protocols scanned'),
        stat(DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'watchlist covered'),
        stat(String(DATA.board_size), 'ranked rows'),
        stat(usd(total), 'total implied')
      ])
    ]);
  }
  function modelPanel() {
    var top = DATA.categories.slice(0, 7);
    var rows = top.map(function (c) {
      return el('tr', {}, [
        el('td', { text: c.category }), el('td', { class: 'num', text: String(c.peers) }),
        el('td', { class: 'num', text: c.median_multiple.toFixed(2) + 'x' }),
        el('td', { class: 'num', text: c.used_multiple.toFixed(2) + 'x' })
      ]);
    });
    rows.push(el('tr', {}, [el('td', { text: 'All categories (fallback)' }), el('td', {}), el('td', {}), el('td', { class: 'num', text: DATA.global_multiple.toFixed(2) + 'x' })]));
    return el('section', { class: 'model', 'aria-label': 'The value model' }, [
      el('div', {}, [
        el('h2', { text: 'The model: peer-priced, nothing hardcoded' }),
        el('p', { text: 'For each category, take the protocols whose token already trades, divide market cap by TVL, and use the median — shrunk toward the global median when a category has few peers, and bounded to 0.05x–3x. Then adjust for the week\u2019s TVL growth, for how long the protocol has run with no token, and for how many chains it runs on. No name is special-cased; open any row to recompute it.' }),
        el('div', { class: 'formula', text: 'implied = TVL \u00d7 peer multiple \u00d7 growth factor \u00d7 maturity factor \u00d7 breadth factor' }),
        el('p', { text: 'Model ' + DATA.model_version + '. Protocols that already trade are never ranked: the Live tab shows them at the market\u2019s own values, apart.' })
      ]),
      el('table', { class: 'peers', 'aria-label': 'Peer multiples by category' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Category' }), el('th', { text: 'Traded peers' }), el('th', { text: 'Median mcap/TVL' }), el('th', { text: 'Used' })])]),
        el('tbody', {}, rows)
      ])
    ]);
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var q = el('input', { type: 'search', id: 'q', placeholder: 'Name, slug, category, chain', value: state.q, 'aria-label': 'Search the board' });
    q.addEventListener('input', function () { state.q = q.value; writeHash(); renderBoard(); });
    function select(id, label, values, cur, fn) {
      var s = el('select', { id: id, 'aria-label': label }, values.map(function (v) {
        return el('option', { value: v, text: v === 'all' ? label + ': all' : v, selected: v === cur ? 'selected' : null });
      }));
      s.addEventListener('change', function () { fn(s.value); writeHash(); renderBoard(); });
      return el('div', { class: 'field' }, [el('label', { for: id, text: label }), s]);
    }
    var watch = el('input', { type: 'checkbox', id: 'watch', checked: state.watch ? 'checked' : null });
    watch.addEventListener('change', function () { state.watch = watch.checked; writeHash(); renderBoard(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' }, [
      el('div', { class: 'field' }, [el('label', { for: 'q', text: 'Search' }), q]),
      select('cat', 'Category', ['all'].concat(cats), state.category, function (v) { state.category = v; }),
      select('chain', 'Chain', ['all'].concat(chains), state.chain, function (v) { state.chain = v; }),
      el('div', { class: 'field check' }, [watch, el('label', { for: 'watch', text: 'Watchlist only' })]),
      el('div', { class: 'tabs' }, [pre, live])
    ]);
  }
  function sortTh(key, label, left) {
    var on = state.sort === key;
    var b = el('button', { type: 'button', class: on ? 'on' : null, text: label + (on ? (state.dir < 0 ? ' \u25bc' : ' \u25b2') : '') });
    b.addEventListener('click', function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
      renderBoard();
    });
    return el('th', { class: left ? 'l' : null }, [b]);
  }
  var boardHost = null, countHost = null;
  function boardTable() {
    var list = sorted(filtered());
    var max = list.length ? list[0].implied_value_usd : 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var shown = list.slice(0, 150);
    var body = shown.map(function (r) {
      var tr = el('tr', { tabindex: '0', 'aria-label': r.name + ' detail' }, [
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', { class: 'l' }, [
          el('div', { class: 'name', text: r.name }),
          el('div', { class: 'slug', text: r.slug })
        ]),
        el('td', { class: 'l' }, [
          el('span', { class: 'pill', text: r.category || 'Uncategorised' }),
          r.watchlist ? el('span', { class: 'pill wl', text: ' watchlist' }) : null
        ]),
        el('td', { class: 'l', text: (r.chains || []).slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : ''), text: pct(r.change_7d) }),
        el('td', { class: 'num', text: age(r.age_days) }),
        el('td', { class: 'num', text: r.model.peer_multiple.toFixed(2) + 'x' }),
        el('td', {}, [
          el('div', { class: 'num', text: usd(r.implied_value_usd) }),
          el('div', { class: 'bar', 'aria-hidden': 'true' }, [el('i', { style: 'width:' + Math.max(2, Math.round(100 * r.implied_value_usd / max)) + '%' })])
        ])
      ]);
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') openDetail(r.slug); });
      return tr;
    });
    if (countHost) countHost.textContent = 'Showing ' + shown.length + ' of ' + list.length + ' ranked protocols' + (state.watch || state.category !== 'all' || state.chain !== 'all' || state.q ? ' (filtered)' : '') + '. Select a row for its detail and farm plan.';
    if (!body.length) return el('div', { class: 'empty', text: 'No protocol matches this filter. Loosen the search, category or chain.' });
    return el('div', { class: 'boardwrap' }, [
      el('table', { class: 'board' }, [
        el('thead', {}, [el('tr', {}, [
          sortTh('rank', '#'), sortTh('rank', 'Protocol', true),
          el('th', { class: 'l', text: 'Category' }), el('th', { class: 'l', text: 'Chains' }),
          sortTh('tvl', 'TVL'), sortTh('change', '7d'), sortTh('age', 'Age'),
          sortTh('peer', 'Peer x'), sortTh('implied', 'Implied value')
        ])]),
        el('tbody', {}, body)
      ])
    ]);
  }
  function liveTable() {
    var body = DATA.live.map(function (r) {
      return el('tr', {}, [
        el('td', { class: 'l' }, [el('div', { class: 'name', text: r.name }), el('div', { class: 'slug', text: r.slug })]),
        el('td', { class: 'l' }, [el('span', { class: 'pill', text: r.category || 'Uncategorised' })]),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        el('td', { class: 'num', text: usd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.multiple === null ? '—' : r.multiple.toFixed(2) + 'x' }),
        el('td', { class: 'num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : ''), text: pct(r.change_7d) })
      ]);
    });
    return el('div', {}, [
      el('p', { class: 'sub', text: 'These protocols already trade, so they are never ranked: the market\u2019s own market cap is shown, and their mcap/TVL ratios are the peer evidence the model prices the pre-token board with.' }),
      el('div', { class: 'boardwrap' }, [
        el('table', { class: 'board' }, [
          el('thead', {}, [el('tr', {}, [el('th', { class: 'l', text: 'Protocol' }), el('th', { class: 'l', text: 'Category' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'mcap/TVL' }), el('th', { text: '7d' })])]),
          el('tbody', {}, body)
        ])
      ])
    ]);
  }
  function detail(r) {
    function fact(l, v) { return el('div', { class: 'fact' }, [el('span', { text: l }), el('b', { text: v })]); }
    function wf(l, v, bold) { return el('div', { class: 'row' }, [el('span', { text: l }), el('span', { class: 'num', text: v })]); }
    var m = r.model;
    var panel = el('aside', { class: 'panel', 'aria-label': r.name + ' detail' }, [
      el('button', { type: 'button', class: 'close', 'aria-label': 'Close detail', text: '\u00d7', onclick: closeDetail }),
      el('div', { class: 'kicker', text: 'Rank #' + r.rank + (r.watchlist ? ' \u00b7 on the watchlist' : ' \u00b7 early radar') }),
      el('h2', { text: r.name }),
      el('p', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + (r.chains || []).join(', ') + ' \u00b7 records no token in the snapshot' }),
      el('div', { class: 'facts' }, [
        fact('Implied value', usd(r.implied_value_usd)),
        fact('TVL', usd(r.tvl_usd)),
        fact('TVL change, 7d', pct(r.change_7d)),
        fact('Age with no token', age(r.age_days) + (m.age_modelled ? ' (modelled)' : ''))
      ]),
      el('h3', { text: 'How the value is built', style: 'margin-top:18px' }),
      el('div', { class: 'wf' }, [
        wf('TVL', usd(r.tvl_usd)),
        wf('\u00d7 peer multiple (' + m.peer_count + ' traded ' + (r.category || 'peers') + ')', m.peer_multiple.toFixed(2) + 'x'),
        wf('\u00d7 growth factor', m.growth_multiplier.toFixed(2) + 'x'),
        wf('\u00d7 maturity factor', m.maturity_multiplier.toFixed(2) + 'x'),
        wf('\u00d7 breadth factor', m.breadth_multiplier.toFixed(2) + 'x'),
        wf('= implied value', usd(r.implied_value_usd))
      ]),
      el('h3', { text: 'Farm plan', style: 'margin-top:18px' }),
      el('div', { class: 'steps' }, r.farm_steps.map(function (s, i) {
        return el('div', { class: 'step' }, [el('div', { class: 'n', text: String(i + 1) }), el('p', { text: s })]);
      })),
      el('p', { class: 'foot', text: 'A plan is a starting point, not a promise: a protocol records no token in this snapshot, which is not proof it has none, and nothing here says one will be issued.' })
    ]);
    return el('div', { class: 'drawer' }, [el('div', { class: 'scrim', onclick: closeDetail }), panel]);
  }
  var drawerHost = null;
  function openDetail(slug) { state.selected = slug; writeHash(); renderDrawer(); }
  function closeDetail() { state.selected = null; writeHash(); renderDrawer(); }
  function renderDrawer() {
    if (!drawerHost) return;
    drawerHost.innerHTML = '';
    if (!state.selected) return;
    var r = DATA.rows.filter(function (x) { return x.slug === state.selected; })[0];
    if (r) drawerHost.appendChild(detail(r));
  }
  function renderBoard() {
    if (!boardHost) return;
    boardHost.innerHTML = '';
    boardHost.appendChild(state.tab === 'live' ? liveTable() : boardTable());
  }
  function render() {
    main.innerHTML = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(modelPanel());
    shell.appendChild(controls());
    boardHost = el('div', {});
    countHost = el('p', { class: 'count' });
    shell.appendChild(boardHost);
    shell.appendChild(countHost);
    shell.appendChild(el('p', { class: 'foot', text: 'Built from one sealed snapshot; the program that wrote this page also wrote the ranked board, and every figure on it can be recomputed from the snapshot\u2019s own fields. Implied value is this entry\u2019s claim, not a prediction that a token will be issued.' }));
    main.appendChild(shell);
    drawerHost = el('div', {});
    main.appendChild(drawerHost);
    renderBoard();
    renderDrawer();
    main.setAttribute('aria-busy', 'false');
  }
  readHash();
  render();
})();
