/* AI QA · шар рецензування: виділення тексту → коментар, треди, панель, експорт.
   Дані: Supabase (RPC-функції з supabase/schema.sql). Без налаштованої бази — демо-режим у браузері. */
(() => {
  const CFG = window.QA_CONFIG || {};
  const ME = document.currentScript;
  const DOC = (ME && ME.dataset.doc) || location.pathname.split('/').pop().replace(/\.html?$/, '') || 'index';
  const ROOT = document.querySelector('main.lr') || document.querySelector('main') || document.body;
  const ART = CFG.backend === 'artifact';
  const DEMO = !ART && (!CFG.url || !CFG.anon);
  let DB = null, COL = null, onRemote = null;
  const LS = k => 'qa_' + k;
  const ls = {
    get(k, d = '') { try { return localStorage.getItem(LS(k)) ?? d } catch (e) { return d } },
    set(k, v) { try { localStorage.setItem(LS(k), v) } catch (e) { } },
    del(k) { try { localStorage.removeItem(LS(k)) } catch (e) { } }
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  let KEY = '', ROLE = '', NAME = ls.get('name'), CLIENT = ls.get('client');
  if (!CLIENT) { CLIENT = uid(); ls.set('client', CLIENT) }
  const urlKey = new URLSearchParams(location.search).get('k');
  if (urlKey) { ls.set('key', urlKey); history.replaceState(null, '', location.pathname + location.hash) }
  KEY = ls.get('key');

  /* ---------- бекенд ---------- */
  const rpc = (fn, body) => fetch(CFG.url.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
    method: 'POST', headers: { apikey: CFG.anon, Authorization: 'Bearer ' + CFG.anon, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(t || r.status); return t ? JSON.parse(t) : null });

  const demoAll = () => { try { return JSON.parse(ls.get('demo_' + DOC, '[]')) } catch (e) { return [] } };
  const demoSave = a => ls.set('demo_' + DOC, JSON.stringify(a));
  const now = () => new Date().toISOString();
  const api = ART ? {
    login: async () => 'reviewer',
    list: async () => (await COL.where('doc', '==', DOC).get()).docs.map(d => ({ id: d.id, ...d.data() })),
    add: async c => { const ref = COL.doc(); const r = { doc: DOC, parent_id: c.parent_id || null, author: c.author, client_id: CLIENT, quote: c.quote || null, prefix: c.prefix || null, suffix: c.suffix || null, section: c.section || null, body: c.body, status: 'open', created_at: now(), updated_at: now() }; await ref.set(r); return { id: ref.id, ...r } },
    edit: (id, body) => COL.doc(id).update({ body, updated_at: now() }),
    status: (id, st) => COL.doc(id).update({ status: st, updated_at: now() }),
    del: async id => { for (const r of ALL.filter(x => x.parent_id === id)) await COL.doc(r.id).delete(); await COL.doc(id).delete() }
  } : DEMO ? {
    login: async () => 'admin',
    list: async () => demoAll(),
    add: async c => { const a = demoAll(); const r = { ...c, id: uid(), doc: DOC, status: 'open', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; a.push(r); demoSave(a); return r },
    edit: async (id, body) => demoSave(demoAll().map(c => c.id === id ? { ...c, body, updated_at: new Date().toISOString() } : c)),
    status: async (id, st) => demoSave(demoAll().map(c => c.id === id ? { ...c, status: st } : c)),
    del: async id => demoSave(demoAll().filter(c => c.id !== id && c.parent_id !== id))
  } : {
    login: () => rpc('qa_login', { p_key: KEY }),
    list: () => rpc('qa_list', { p_key: KEY, p_doc: DOC }),
    add: c => rpc('qa_add', { p_key: KEY, p_doc: DOC, p_parent: c.parent_id || null, p_author: c.author, p_client: CLIENT, p_quote: c.quote || null, p_prefix: c.prefix || null, p_suffix: c.suffix || null, p_section: c.section || null, p_body: c.body }),
    edit: (id, body) => rpc('qa_edit', { p_key: KEY, p_id: id, p_client: CLIENT, p_body: body }),
    status: (id, st) => rpc('qa_set_status', { p_key: KEY, p_id: id, p_status: st }),
    del: id => rpc('qa_delete', { p_key: KEY, p_id: id, p_client: CLIENT })
  };

  /* ---------- текстовий індекс ---------- */
  const SKIP = 'script,style,noscript,.qa-ui,.tip-p,nav,svg';
  function index() {
    const nodes = []; let str = '';
    const w = document.createTreeWalker(ROOT, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    for (let n; (n = w.nextNode());) { nodes.push({ n, s: str.length }); str += n.data }
    return { nodes, str };
  }
  function rangeToOffsets(r) {
    const { nodes, str } = index(); let s = -1, e = -1;
    for (const x of nodes) {
      if (!r.intersectsNode(x.n)) continue;
      const a = x.n === r.startContainer ? r.startOffset : 0;
      const b = x.n === r.endContainer ? r.endOffset : x.n.length;
      if (s < 0) s = x.s + a;
      e = x.s + b;
    }
    if (s < 0 || e <= s) return null;
    while (s < e && /\s/.test(str[s])) s++;
    while (e > s && /\s/.test(str[e - 1])) e--;
    if (e <= s) return null;
    return { s, e, quote: str.slice(s, e), prefix: str.slice(Math.max(0, s - 48), s), suffix: str.slice(e, e + 48) };
  }
  function locate(c, str) {
    if (!c.quote) return null;
    let best = null, bestScore = -1, i = -1;
    while ((i = str.indexOf(c.quote, i + 1)) !== -1) {
      const pre = str.slice(Math.max(0, i - 48), i), suf = str.slice(i + c.quote.length, i + c.quote.length + 48);
      let sc = 0;
      const P = c.prefix || '', S = c.suffix || '';
      for (let k = 1; k <= Math.min(P.length, pre.length) && P[P.length - k] === pre[pre.length - k]; k++) sc++;
      for (let k = 0; k < Math.min(S.length, suf.length) && S[k] === suf[k]; k++) sc++;
      if (sc > bestScore) { bestScore = sc; best = i }
    }
    return best === null ? null : { s: best, e: best + c.quote.length };
  }
  const BAD_PARENT = /^(TABLE|TBODY|THEAD|TFOOT|TR|UL|OL|DL|SELECT)$/;
  function wrap(s, e, cls, id) {
    const { nodes } = index(); const marks = [];
    for (const x of nodes) {
      const ns = x.s, ne = x.s + x.n.length;
      if (ne <= s || ns >= e) continue;
      if (!x.n.data.trim() && BAD_PARENT.test(x.n.parentNode.nodeName)) continue;
      let node = x.n; const a = Math.max(s, ns) - ns, b = Math.min(e, ne) - ns;
      if (a >= b) continue;
      if (b < node.length) node.splitText(b);
      if (a > 0) node = node.splitText(a);
      const m = document.createElement('mark'); m.className = 'qa-hl ' + cls; if (id) m.dataset.qa = id;
      node.parentNode.insertBefore(m, node); m.appendChild(node); marks.push(m);
    }
    return marks;
  }
  function unwrapAll(sel = 'mark.qa-hl') {
    ROOT.querySelectorAll(sel).forEach(m => { const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); p.normalize() });
  }
  function sectionOf(node) {
    const hs = [...ROOT.querySelectorAll('h1,h2,h3')]; let h = null;
    for (const x of hs) { if (x.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING || x.contains(node)) h = x; else break }
    return h ? h.textContent.trim() : '';
  }
  function currentSection() {
    const hs = [...ROOT.querySelectorAll('h2,h3')]; let h = hs[0];
    for (const x of hs) if (x.getBoundingClientRect().top < 140) h = x;
    return h ? h.textContent.trim() : '';
  }

  /* ---------- стан ---------- */
  let dirty = false, ALL = [], POS = {}, FILTER = ls.get('filter', 'open'), WHO = '', busy = false;
  const threads = () => ALL.filter(c => !c.parent_id);
  const replies = id => ALL.filter(c => c.parent_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const fmt = t => { try { return new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' } };
  const mine = c => c.client_id === CLIENT;

  function paint() {
    unwrapAll();
    POS = {};
    const { str } = index();
    const list = threads().map(c => ({ c, p: locate(c, str) }));
    list.filter(x => x.p).sort((a, b) => (b.p.e - b.p.s) - (a.p.e - a.p.s)).forEach(({ c, p }) => {
      POS[c.id] = p.s; wrap(p.s, p.e, c.status === 'resolved' ? 'qa-res' : '', c.id);
    });
    document.body.classList.toggle('qa-hide-res', FILTER !== 'all' && FILTER !== 'resolved');
    renderList(); updCount();
  }
  async function load(quiet) {
    try { ALL = (await api.list()) || []; paint() }
    catch (e) { if (!quiet) toast('Не вдалося завантажити коментарі') }
  }

  /* ---------- UI каркас ---------- */
  const ui = document.createElement('div'); ui.className = 'qa-ui';
  ui.innerHTML = `
    <div class="qa-top"><div class="qa-pill">${DEMO ? '<span class="qa-demo">ДЕМО</span>' : ''}<span class="nm">Рецензування · <b id="qa-name"></b></span>
      <button class="qa-btn sm ghost" id="qa-rename" title="Змінити ім’я">✎</button>
      <button class="qa-btn sm pri" id="qa-open">Коментарі<span class="qa-count" id="qa-cnt">0</span></button></div></div>
    <div class="qa-fab" id="qa-fab"><button type="button">💬 Коментувати</button></div>
    <aside class="qa-drawer" id="qa-drawer" aria-label="Коментарі">
      <div class="qa-dh"><div style="display:flex;align-items:center;gap:8px"><h3 style="flex:1">Коментарі</h3><button class="qa-btn sm ghost" id="qa-close" aria-label="Закрити">✕</button></div>
        <div class="qa-filters"><div class="qa-seg" id="qa-seg"><button data-f="open">Відкриті</button><button data-f="resolved">Вирішені</button><button data-f="all">Усі</button></div>
        <select class="qa-sel" id="qa-who"><option value="">Усі автори</option></select></div></div>
      <div class="qa-gen"><button class="qa-btn sm" id="qa-general">+ Загальний коментар до розділу</button></div>
      <div class="qa-list" id="qa-list"></div>
      <div class="qa-df" id="qa-df"><button class="qa-btn sm" id="qa-csv">⬇ CSV</button><button class="qa-btn sm" id="qa-md">⬇ Markdown</button><button class="qa-btn sm ghost" id="qa-reload">↻ Оновити</button></div>
    </aside>
    <div class="qa-toast" id="qa-toast"></div>`;
  document.body.appendChild(ui);
  const $ = id => document.getElementById(id);
  const fab = $('qa-fab'), drawer = $('qa-drawer');
  let pop = null;
  const toast = (t) => { const el = $('qa-toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2400) };
  const setName = () => { $('qa-name').textContent = NAME || '—' };

  function updCount() {
    const open = threads().filter(c => c.status !== 'resolved').length;
    $('qa-cnt').textContent = open;
    const authors = [...new Set(ALL.map(c => c.author))].sort();
    $('qa-who').innerHTML = '<option value="">Усі автори</option>' + authors.map(a => `<option ${a === WHO ? 'selected' : ''}>${esc(a)}</option>`).join('');
  }
  function renderList() {
    $('qa-seg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.f === FILTER));
    let t = threads().filter(c => FILTER === 'all' || (FILTER === 'resolved' ? c.status === 'resolved' : c.status !== 'resolved'));
    if (WHO) t = t.filter(c => c.author === WHO || replies(c.id).some(r => r.author === WHO));
    t.sort((a, b) => (POS[a.id] ?? 1e12) - (POS[b.id] ?? 1e12) || a.created_at.localeCompare(b.created_at));
    $('qa-list').innerHTML = t.length ? t.map(c => {
      const r = replies(c.id), orph = c.quote && POS[c.id] === undefined;
      return `<div class="qa-card ${c.status === 'resolved' ? 'res' : ''} ${orph ? 'orph' : ''}" data-id="${c.id}">
        ${c.section ? `<div class="qa-sec">${esc(c.section)}</div>` : ''}
        ${c.quote ? `<div class="qa-q">${esc(c.quote)}</div>` : '<div class="qa-q" style="border-left-color:#b9b8ea">Загальний коментар</div>'}
        <div class="qa-meta"><b>${esc(c.author)}</b><span>${fmt(c.created_at)}</span>${c.status === 'resolved' ? '<span class="qa-status res">вирішено</span>' : ''}</div>
        <div class="qa-body">${esc(c.body)}</div>
        ${r.length ? `<div class="rep">↳ ${r.length} ${r.length === 1 ? 'відповідь' : 'відповіді'}</div>` : ''}
        ${orph ? '<div class="qa-hint" style="color:#b03030">Текст у матеріалі змінився — фрагмент не знайдено</div>' : ''}</div>`
    }).join('') : `<div class="qa-empty">${FILTER === 'resolved' ? 'Вирішених коментарів ще немає.' : 'Коментарів поки немає.<br>Виділіть фрагмент тексту, щоб залишити коментар.'}</div>`;
  }

  /* ---------- поповери ---------- */
  function closePop(keepPending) {
    if (pop) { pop.remove(); pop = null }
    if (!keepPending) unwrapAll('mark.qa-pending');
    if (dirty) { dirty = false; setTimeout(paint, 0) }
    ROOT.querySelectorAll('mark.qa-active').forEach(m => m.classList.remove('qa-active'));
  }
  function place(el, rect) {
    const W = document.documentElement.clientWidth, w = Math.min(360, W - 24);
    let left = rect.left + scrollX + rect.width / 2 - w / 2;
    left = Math.max(12 + scrollX, Math.min(left, scrollX + W - w - 12));
    let top = rect.bottom + scrollY + 10;
    el.style.left = left + 'px'; el.style.top = top + 'px';
    document.body.appendChild(el);
    const h = el.getBoundingClientRect().height;
    if (rect.bottom + 10 + h > innerHeight && rect.top - h - 10 > 0) el.style.top = (rect.top + scrollY - h - 10) + 'px';
  }
  function composer(sel, rect) {
    closePop();
    const marks = sel.quote ? wrap(sel.s, sel.e, 'qa-pending') : [];
    pop = document.createElement('div'); pop.className = 'qa-pop qa-ui';
    pop.innerHTML = `${sel.section ? `<div class="qa-sec">${esc(sel.section)}</div>` : ''}
      ${sel.quote ? `<div class="qa-q">${esc(sel.quote)}</div>` : '<div class="qa-q" style="border-left-color:#b9b8ea">Загальний коментар до розділу</div>'}
      <textarea class="qa-ta" placeholder="Ваш коментар…"></textarea>
      <div class="qa-row"><span class="qa-hint sp">Ctrl/⌘ + Enter — зберегти</span><button class="qa-btn sm" data-a="x">Скасувати</button><button class="qa-btn sm pri" data-a="ok">Зберегти</button></div>`;
    const r = rect || (marks[0] ? marks[0].getBoundingClientRect() : { left: innerWidth / 2, width: 0, top: 120, bottom: 120 });
    place(pop, r);
    const ta = pop.querySelector('textarea'); ta.focus();
    const save = async () => {
      const body = ta.value.trim(); if (!body || busy) return; busy = true;
      pop.querySelector('[data-a=ok]').disabled = true;
      try {
        const c = await api.add({ author: NAME, client_id: CLIENT, quote: sel.quote, prefix: sel.prefix, suffix: sel.suffix, section: sel.section, body });
        ALL.push(c); closePop(); paint(); toast('Коментар збережено');
      } catch (e) { toast('Не збережено: немає з’єднання з базою'); pop && (pop.querySelector('[data-a=ok]').disabled = false) }
      busy = false;
    };
    pop.querySelector('[data-a=ok]').onclick = save;
    pop.querySelector('[data-a=x]').onclick = () => closePop();
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); if (e.key === 'Escape') closePop() });
  }
  function thread(id, anchorEl) {
    const c = ALL.find(x => x.id === id); if (!c) return;
    closePop();
    ROOT.querySelectorAll(`mark.qa-hl[data-qa="${id}"]`).forEach(m => m.classList.add('qa-active'));
    const canEdit = x => mine(x) || ROLE === 'admin';
    const msg = x => `<div class="qa-msg" data-id="${x.id}"><div class="qa-meta"><b>${esc(x.author)}</b><span>${fmt(x.created_at)}</span>
        ${canEdit(x) ? `<span class="acts"><button class="qa-btn sm ghost" data-a="edit" title="Редагувати">✎</button><button class="qa-btn sm ghost" data-a="del" title="Видалити">🗑</button></span>` : ''}</div>
        <div class="qa-body">${esc(x.body)}</div></div>`;
    pop = document.createElement('div'); pop.className = 'qa-pop qa-ui';
    pop.innerHTML = `<button class="qa-btn sm ghost qa-x" data-a="x" aria-label="Закрити">✕</button>
      ${c.section ? `<div class="qa-sec" style="padding-right:28px">${esc(c.section)}</div>` : ''}
      ${c.quote ? `<div class="qa-q">${esc(c.quote)}</div>` : ''}
      <div style="margin-bottom:6px"><span class="qa-status ${c.status === 'resolved' ? 'res' : ''}">${c.status === 'resolved' ? 'вирішено' : 'відкрито'}</span></div>
      ${msg(c)}${replies(id).map(msg).join('')}
      <textarea class="qa-ta" style="min-height:54px" placeholder="Відповісти…"></textarea>
      <div class="qa-row"><button class="qa-btn sm" data-a="st">${c.status === 'resolved' ? '↺ Відкрити знову' : '✓ Вирішено'}</button><span class="sp"></span><button class="qa-btn sm pri" data-a="rep">Відповісти</button></div>`;
    const m = anchorEl || ROOT.querySelector(`mark.qa-hl[data-qa="${id}"]`);
    place(pop, m ? m.getBoundingClientRect() : { left: innerWidth / 2, width: 0, top: 120, bottom: 120 });
    const ta = pop.querySelector('textarea');
    const reply = async () => {
      const body = ta.value.trim(); if (!body || busy) return; busy = true;
      try { const r = await api.add({ parent_id: id, author: NAME, client_id: CLIENT, body }); ALL.push(r); renderList(); thread(id) }
      catch (e) { toast('Не збережено: немає з’єднання з базою') }
      busy = false;
    };
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) reply(); if (e.key === 'Escape') closePop() });
    pop.addEventListener('click', async e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a, mid = b.closest('.qa-msg')?.dataset.id;
      if (a === 'x') return closePop();
      if (a === 'rep') return reply();
      if (a === 'st') { const st = c.status === 'resolved' ? 'open' : 'resolved'; try { await api.status(id, st); c.status = st; closePop(); paint(); toast(st === 'resolved' ? 'Позначено як вирішене' : 'Відкрито знову') } catch (er) { toast('Помилка збереження') } return }
      if (a === 'del') {
        if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = mid === id ? 'Видалити все?' : 'Видалити?'; b.style.color = '#b03030'; return }
        try { await api.del(mid); ALL = ALL.filter(x => x.id !== mid && x.parent_id !== mid); closePop(); paint(); if (mid !== id) thread(id) } catch (er) { toast('Помилка видалення') }
        return;
      }
      if (a === 'edit') {
        const box = b.closest('.qa-msg'), x = ALL.find(y => y.id === mid), bd = box.querySelector('.qa-body');
        bd.outerHTML = `<textarea class="qa-ta">${esc(x.body)}</textarea><div class="qa-row"><button class="qa-btn sm" data-a="ecx">Скасувати</button><button class="qa-btn sm pri" data-a="eok">Зберегти</button></div>`;
        box.querySelector('textarea').focus(); return;
      }
      if (a === 'ecx') return thread(id);
      if (a === 'eok') {
        const x = ALL.find(y => y.id === mid), v = b.closest('.qa-msg').querySelector('textarea').value.trim(); if (!v) return;
        try { await api.edit(mid, v); x.body = v; renderList(); thread(id) } catch (er) { toast('Помилка збереження') }
      }
    });
  }

  /* ---------- виділення ---------- */
  let pendingSel = null;
  function checkSel() {
    const s = getSelection();
    if (!s || s.isCollapsed || !s.rangeCount || !NAME || pop) { fab.style.display = 'none'; return }
    const r = s.getRangeAt(0);
    if (!ROOT.contains(r.commonAncestorContainer) || (r.commonAncestorContainer.parentElement || r.commonAncestorContainer).closest?.('.qa-ui')) { fab.style.display = 'none'; return }
    const o = rangeToOffsets(r); if (!o) { fab.style.display = 'none'; return }
    o.section = sectionOf(r.startContainer);
    pendingSel = o;
    const rc = r.getBoundingClientRect();
    fab.style.left = (rc.left + scrollX + rc.width / 2) + 'px';
    fab.style.top = (rc.top + scrollY) + 'px';
    fab.style.display = 'block';
  }
  let st;
  document.addEventListener('selectionchange', () => { clearTimeout(st); st = setTimeout(checkSel, 180) });
  fab.addEventListener('mousedown', e => e.preventDefault());
  fab.querySelector('button').addEventListener('click', () => {
    if (!pendingSel) return;
    const r = getSelection().rangeCount ? getSelection().getRangeAt(0).getBoundingClientRect() : null;
    fab.style.display = 'none'; const sel = pendingSel; pendingSel = null;
    getSelection().removeAllRanges(); composer(sel, r);
  });
  ROOT.addEventListener('click', e => {
    const m = e.target.closest('mark.qa-hl[data-qa]');
    if (!m || (m.classList.contains('qa-res') && document.body.classList.contains('qa-hide-res'))) return;
    if (!getSelection().isCollapsed) return;
    e.preventDefault(); thread(m.dataset.qa, m);
  });
  document.addEventListener('mousedown', e => { if (pop && !pop.contains(e.target) && !e.target.closest('mark.qa-hl') && !e.target.closest('.qa-fab')) closePop() });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); drawer.classList.remove('open') } });

  /* ---------- панель ---------- */
  $('qa-open').onclick = () => drawer.classList.toggle('open');
  $('qa-close').onclick = () => drawer.classList.remove('open');
  $('qa-seg').onclick = e => { const b = e.target.closest('button'); if (!b) return; FILTER = b.dataset.f; ls.set('filter', FILTER); paint() };
  $('qa-who').onchange = e => { WHO = e.target.value; renderList() };
  $('qa-reload').onclick = () => ART ? (paint(), toast('Оновлюється автоматично')) : load().then(() => toast('Оновлено'));
  $('qa-general').onclick = () => { drawer.classList.remove('open'); composer({ quote: '', prefix: '', suffix: '', section: currentSection() }) };
  $('qa-list').onclick = e => {
    const card = e.target.closest('.qa-card'); if (!card) return;
    const id = card.dataset.id, c = ALL.find(x => x.id === id);
    const m = ROOT.querySelector(`mark.qa-hl[data-qa="${id}"]`);
    if (c.status === 'resolved') document.body.classList.remove('qa-hide-res');
    if (innerWidth < 1100) drawer.classList.remove('open');
    if (m) {
      m.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const ms = ROOT.querySelectorAll(`mark.qa-hl[data-qa="${id}"]`);
      ms.forEach(x => { x.classList.remove('qa-flash'); void x.offsetWidth; x.classList.add('qa-flash') });
      setTimeout(() => thread(id, m), 450);
    } else thread(id);
  };
  const download = (name, text, type) => {
    if (!ART) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); return }
    const m = document.createElement('div'); m.className = 'qa-modal qa-ui';
    m.innerHTML = `<div class="qa-box" style="width:640px"><h2>${esc(name)}</h2><p>Скопіюйте текст і вставте в документ або таблицю.</p><textarea class="qa-ta" style="min-height:300px;font:12px/1.5 ui-monospace,monospace" readonly></textarea><div class="qa-row"><span class="qa-hint sp" id="qa-cpm"></span><button class="qa-btn" data-a="c">Закрити</button><button class="qa-btn pri" data-a="cp">Копіювати</button></div></div>`;
    const ta = m.querySelector('textarea'); ta.value = text.replace(/^\ufeff/, '');
    m.onclick = async e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'c' || e.target === m) m.remove(); if (a === 'cp') { try { await navigator.clipboard.writeText(ta.value); m.querySelector('#qa-cpm').textContent = '✓ Скопійовано' } catch (er) { ta.select(); m.querySelector('#qa-cpm').textContent = 'Натисніть Ctrl/⌘+C' } } };
    document.body.appendChild(m); ta.select();
  };
  const title = (document.title || DOC).trim();
  const paraOf = c => {
    const m = ROOT.querySelector(`mark.qa-hl[data-qa="${c.id}"]`); if (!m) return '';
    const b = m.closest('p,li,td,th,h1,h2,h3,h4,dd,dt,blockquote,figcaption,.w,.k') || m.parentElement;
    const cl = b.cloneNode(true); cl.querySelectorAll('.tip-p,.qa-ui').forEach(x => x.remove());
    return cl.textContent.replace(/\s+/g, ' ').trim();
  };
  const ordered = () => threads().slice().sort((a, b) => (POS[a.id] ?? 1e12) - (POS[b.id] ?? 1e12));
  if (ART) { $('qa-csv').textContent = '⧉ CSV'; $('qa-md').textContent = '⧉ Markdown' }
  $('qa-csv').onclick = () => {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = [['Розділ', 'Абзац', 'Виділений фрагмент', 'Автор', 'Коментар', 'Статус', 'Дата', 'Тип']];
    ordered().forEach(c => { const pa = paraOf(c); rows.push([c.section, pa, c.quote, c.author, c.body, c.status === 'resolved' ? 'вирішено' : 'відкрито', fmt(c.created_at), 'коментар']); replies(c.id).forEach(r => rows.push([c.section, pa, c.quote, r.author, r.body, '', fmt(r.created_at), 'відповідь'])) });
    download(`${DOC}-comments.csv`, '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  };
  $('qa-md').onclick = () => {
    let md = `# Коментарі експертів: ${title}\n\nДокумент: ${DOC} · експорт ${fmt(new Date().toISOString())}\n\n`, sec = null, n = 0;
    ordered().forEach(c => {
      if (c.section !== sec) { sec = c.section; md += `## ${sec || 'Без розділу'}\n\n` }
      const pa = paraOf(c);
      md += `### Коментар ${++n}\n\n` + (pa ? `**Абзац:**\n\n> ${pa}\n\n` : '') + (c.quote ? `**Виділено:** «${c.quote.replace(/\s+/g, ' ')}»\n\n` : '**Загальний коментар до розділу**\n\n') + `- **${c.author}** (${fmt(c.created_at)})${c.status === 'resolved' ? ' ✓ вирішено' : ''}: ${c.body}\n`;
      replies(c.id).forEach(r => md += `  - ↳ **${r.author}**: ${r.body}\n`); md += '\n';
    });
    download(`${DOC}-comments.md`, md, 'text/markdown;charset=utf-8');
  };

  /* ---------- вхід ---------- */
  function loginView(msg, rename) {
    const needKey = !DEMO && !ART && !ROLE;
    const m = document.createElement('div'); m.className = 'qa-modal qa-ui';
    m.innerHTML = `<form class="qa-box"><h2>Рецензування матеріалу</h2>
      <p>Виділяйте фрагменти тексту й залишайте коментарі — як у Notion. Коментарі зберігаються автоматично.</p>
      ${needKey ? '<label for="qa-k">Ключ доступу</label><input class="qa-in" id="qa-k" autocomplete="off" required>' : ''}
      <label for="qa-n">Ваше ім’я</label><input class="qa-in" id="qa-n" value="${esc(NAME)}" maxlength="60" required>
      <div class="qa-err">${esc(msg || '')}</div>
      <div class="qa-row"><button class="qa-btn pri" type="submit">Почати</button></div></form>`;
    document.body.appendChild(m);
    (m.querySelector('#qa-k') && !KEY ? m.querySelector('#qa-k') : m.querySelector('#qa-n')).focus();
    if (KEY && m.querySelector('#qa-k')) m.querySelector('#qa-k').value = KEY;
    m.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const n = m.querySelector('#qa-n').value.trim(); if (!n) return;
      if (needKey) { KEY = m.querySelector('#qa-k').value.trim(); ls.set('key', KEY) }
      NAME = n; ls.set('name', NAME); m.remove(); if (rename) setName(); else start();
    };
  }
  async function start() {
    if (ART && !DB) {
      $('qa-name').textContent = 'підключення…';
      const [db, user] = await Promise.all([window.claude?.use?.('db') ?? null, window.claude?.use?.('user') ?? null]);
      if (!db) { $('qa-name').textContent = 'немає доступу'; const m = document.createElement('div'); m.className = 'qa-modal qa-ui'; m.innerHTML = '<div class="qa-box"><h2>Потрібен вхід у Claude</h2><p>Щоб залишати коментарі, увійдіть у свій акаунт Claude і відкрийте це посилання ще раз. Читати матеріал можна й без входу.</p><div class="qa-row"><button class="qa-btn pri">Читати без коментарів</button></div></div>'; m.querySelector('button').onclick = () => m.remove(); document.body.appendChild(m); return }
      DB = db; COL = db.collection('comments');
      try { const id = user && await user.id(); if (id) CLIENT = id; ROLE = (user && await user.isOwner()) ? 'admin' : 'reviewer' } catch (e) { ROLE = 'reviewer' }
    }
    if (ART) {
      if (!NAME) return loginView();
      setName();
      if (!start.sub) {
        const tm = setTimeout(() => toast('База ще не відповідає — спробуйте оновити сторінку'), 10000);
        start.sub = COL.where('doc', '==', DOC).onSnapshot(snap => {
          clearTimeout(tm);
          ALL = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          if (pop) dirty = true; else paint();
        }, err => { clearTimeout(tm); toast('Зв’язок із базою втрачено. Оновіть сторінку.') });
      }
      return;
    }
    if (!DEMO && !ROLE) {
      if (!KEY) return loginView();
      try { ROLE = await api.login() } catch (e) { const bad = /not allowed/.test(e.message); if (bad) { ls.del('key'); KEY = '' } return loginView(bad ? 'Невірний ключ доступу.' : 'Немає з’єднання з базою.') }
    } else if (DEMO) ROLE = 'admin';
    if (!NAME) return loginView();
    setName(); await load();
    if (!start.poll) start.poll = setInterval(() => { if (!pop && !document.hidden) load(true) }, 45000);
  }
  $('qa-rename').onclick = () => { closePop(); loginView('', true) };
  document.addEventListener('visibilitychange', () => { if (!ART && !document.hidden && ROLE && NAME && !pop) load(true) });
  start();
})();
