const $ = (id) => document.getElementById(id);

/* =========================================================
   [CHANGE #1] Admin Area button visibility + navigation
   - Looks for #btnAdminArea on index.html
   - Hidden by default
   - Shown only if session exists AND profiles.role='admin' AND profiles.status='active'
   - Click -> admin-approval.html
   ========================================================= */
(async function setupAdminAreaButton() {
  try {
    const btn = document.getElementById("btnAdminArea");
    if (!btn) return;                 // index.html might not have it yet
    btn.style.display = "none";       // default hidden

    if (!window.sb || !window.sb.auth) return;

    const { data, error } = await window.sb.auth.getSession();
    if (error || !data?.session) return;

    const userId = data.session.user?.id;
    if (!userId) return;

    const { data: prof, error: pErr } = await window.sb
      .from("profiles")
      .select("role,status")
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr || !prof) return;

    const role = String(prof.role || "").toLowerCase();
    const status = String(prof.status || "").toLowerCase();

    if (role === "admin" && status === "active") {
      btn.style.display = "inline-block";
      btn.addEventListener("click", () => {
        window.location.href = "admin-approval.html";
      });
    }
  } catch (e) {
    console.warn("setupAdminAreaButton failed:", e);
  }
})();

(async () => {
  const { data, error } = await window.sb.auth.getSession();
  console.log("SUPABASE getSession:", { data, error });
})();

// Canonicalize svg identifiers across Windows (case-insensitive) and Linux servers (case-sensitive)
function canonSvgBase(seg) {
  const s = String(seg || '');
  // Only normalize the 'pai_' prefix case; keep the rest untouched (codes are typically uppercase like 5A...)
  return s.match(/^pai_/i) ? ('pai_' + s.slice(4)) : s;
}

function canonSvgUrl(url) {
  const s = String(url || '');
  // Normalize only the filename prefix 'pai_' (case-insensitive) inside assets/svgs/ URLs
  return s.replace(/(assets\/svgs\/)pai_/i, '$1pai_');
}

function normPartNo(s) {
  return String(s || '').replace(/[\s\-_]/g, '').toUpperCase();
}


const STORAGE_BASE = "https://ytwwcrhtcsdpqeualnsx.supabase.co/storage/v1/object/public/catalogs";

const state = {
  catalog: null,   // { id, name, pai_code } from DB
  searchMeta: null,
  selected: null,
  cart: JSON.parse(localStorage.getItem('catalogCart') || '[]'),
  path: [],
  map: new Map(),
  bomRows: [],
};

// ── URL helpers ──────────────────────────────────────────────────────────────

function svgUrl(base) {
  const b = canonSvgBase(base);
  const paiCode = state.catalog?.pai_code;
  // SVG raiz fica na raiz da pasta do catálogo; subassemblies em /svg/
  if (b === `pai_${paiCode}` || b.toLowerCase() === `pai_${paiCode}`.toLowerCase()) {
    return `${STORAGE_BASE}/${paiCode}/${b}.svg`;
  }
  return `${STORAGE_BASE}/${paiCode}/svg/${b}.svg`;
}

function thumbUrl(partNo) {
  const paiCode = state.catalog?.pai_code;
  return `${STORAGE_BASE}/${paiCode}/thumb/thumb_${partNo}.jpg`;
}

function thumbDefaultUrl() {
  return `${STORAGE_BASE}/thumb_default.jpg`;
}

function searchIndexUrl() {
  const paiCode = state.catalog?.pai_code;
  return `${STORAGE_BASE}/${paiCode}/search-index.json`;
}

/*// ===== Order request TXT formatting (aligned, like client-area samples) =====
const COL_PN = 12;
const COL_DESC = 40;
const COL_PRICE = 10;
const COL_QTY = 4;

function pad(str, w, right = false) {
  str = String(str ?? '');

  if (str.length > w) {
    // deixa espaço para ellipsis
    str = str.slice(0, w - 1) + '…';
  }

  return right ? str.padStart(w) : str.padEnd(w);
}

function row(pn, desc, price, qty) {
  return (
    pad(pn, COL_PN) +
    pad(desc, COL_DESC) +
    pad(price, COL_PRICE) +
    pad(qty, COL_QTY, true)
  );
}*/




// toast() is provided globally by toast.js (loaded via <script> in the HTML).

async function loadCatalog() {
  const params = new URLSearchParams(window.location.search);
  const paiCode = params.get('catalog');
  if (!paiCode) throw new Error('Missing ?catalog= URL parameter.');

  const { data: { session } } = await window.sb.auth.getSession();
  let isStaff = false;
  if (session) {
    const { data: prof } = await window.sb
      .from('profiles')
      .select('role')
      .eq('user_id', session.user.id)
      .maybeSingle();
    const role = prof?.role || '';
    isStaff = role === 'admin' || role === 'catalog_manager';
  }

  const query = window.sb
    .from('catalogs')
    .select('id, name, pai_code, status')
    .eq('pai_code', paiCode);

  const { data, error } = await (isStaff
    ? query.in('status', ['published', 'draft', 'archived'])
    : query.eq('status', 'published'))
    .maybeSingle();

  if (error) throw new Error('Failed to load catalog: ' + error.message);
  if (!data) throw new Error(`Catalog '${paiCode}' not found or not published.`);

  state.catalog = data;
}

async function loadSearchMeta() {
  state.searchMeta = { codeDesc: {} };
  try {
    const res = await fetch(searchIndexUrl(), { cache: 'no-store' });
    if (!res.ok) return;
    const j = await res.json();
    state.searchMeta.codeDesc = (j && j.codeDesc) ? j.codeDesc : {};
  } catch {
    // ignore; breadcrumbs will fall back to code-only
  }
}


function renderCrumbs() {
  const el = $('crumbs');
  el.innerHTML = '';

  const root = document.createElement('a');
  root.href = '#/';
  root.textContent = state.catalog?.name || 'Catálogo';
  el.appendChild(root);

  // ✅ Só esconder o root "pai_*" se estiver no início
  const hasRootSeg = state.path.length && /^pai_/i.test(state.path[0]);
  const visiblePath = hasRootSeg ? state.path.slice(1) : state.path.slice();
  const offset = hasRootSeg ? 1 : 0;

  const SEP = ' | '; // definir o separador

  for (let i = 0; i < visiblePath.length; i++) {
    const sep = document.createElement('span');
    sep.textContent = '>';
    sep.style.opacity = '0.7';
    el.appendChild(sep);

    const pn = visiblePath[i];

    if (i === visiblePath.length - 1) {
      let desc = '';
      try { desc = sessionStorage.getItem(`pnDesc:${pn}`) || ''; } catch { }

      const s = document.createElement('span');
      s.className = 'current';
      s.textContent = desc ? pn + SEP + desc : pn;
      el.appendChild(s);
    } else {
      const a = document.createElement('a');

      // ✅ Link tem de usar o state.path completo (com root), por isso usamos offset
      a.href = '#/' + state.path.slice(0, i + 1 + offset).join('/');
      a.textContent = pn;

      el.appendChild(a);
    }
  }
}

function clearSelected() {
  $('selTitle').textContent = 'Please select a part or subassembly';
  $('selPn').textContent = '';
  $('selQty').textContent = '';
  $('selPrice').textContent = '';
  $('thumbWrap').innerHTML = '';
  $('btnAdd').disabled = true;
  $('btnOpenSub').disabled = true;
  state.selected = null;
}

function renderCartInto(bodyEl) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '';

  if (!state.cart.length) {
    const d = document.createElement('div');
    d.style.color = '#6b7280';
    d.style.padding = '12px 0';
    d.textContent = 'Cart empty.';
    bodyEl.appendChild(d);
    return;
  }

  state.cart.forEach((row, idx) => {
    const r = document.createElement('div'); r.className = 'cartRow';

    const pn = document.createElement('div'); pn.className = 'pnCell'; pn.textContent = row.partNo;
    const desc = document.createElement('div'); desc.textContent = row.desc;
    const price = document.createElement('div'); price.className = 'priceCell'; price.textContent = row.price || 'TBA';

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.value = String(row.qty);

    qty.addEventListener('change', () => {
      row.qty = Math.max(1, parseInt(qty.value || '1', 10));
      // sincroniza ambas as views
      renderCart();
    });

    const rm = document.createElement('button'); rm.className = 'rmBtn'; rm.textContent = '✕';
    rm.addEventListener('click', () => {
      state.cart.splice(idx, 1);
      renderCart();
    });

    r.append(pn, desc, price, qty, rm);
    bodyEl.appendChild(r);
  });
}

function renderCart() {
  localStorage.setItem('catalogCart', JSON.stringify(state.cart));
  renderCartInto($('cartBody'));       // carrinho pequeno
  renderCartInto($('cartBodyModal'));  // carrinho grande (modal)
  const badge = $('cartBtnBadge');
  if (badge) {
    const total = state.cart.reduce((s, r) => s + (r.qty || 1), 0);
    if (total > 0) { badge.textContent = total; badge.style.display = ''; }
    else { badge.style.display = 'none'; }
  }
}

function openOrderModal() {
  const m = $('orderModal');
  if (!m) return;
  m.hidden = false;
}

function closeOrderModal() {
  const m = $('orderModal');
  if (!m) return;
  m.hidden = true;
}

function setupUI() {
  async function sendOrderRequest() {
    if (!state.cart.length) { toast.error('Your cart is empty!'); return; }

    const btnSend = $('btnModalSend');
    if (btnSend) { btnSend.disabled = true; btnSend.textContent = 'Sending…'; }

    const dt = new Date().toISOString().replace('T', ' ').slice(0, 19);

    let out = '';
    out += 'Order request\n';
    out += `Date/time: ${dt}\n\n`;

    out += 'Items:\n';
    out += 'P/N | Description | Price | Qty\n';
    out += '--------------------------------\n';

    for (const r of state.cart) {
      out += `${r.partNo} | ${r.desc} | ${r.price || 'TBA'} | ${r.qty}\n`;
    }

    // ===== guardar pedido na BD (Supabase) =====
    try {
      const { data: { session } } = await window.sb.auth.getSession();
      const userId = session?.user?.id || null;

      let customerId = null;
      if (userId) {
        const { data: prof } = await window.sb
          .from('profiles')
          .select('customer_id')
          .eq('user_id', userId)
          .maybeSingle();
        customerId = prof?.customer_id || null;
      }

      const { error } = await window.sb.from('order_requests').insert({
        user_id: userId,
        content_text: out,
        catalog_id: state.catalog?.id || null,
        customer_id: customerId,
      });

      if (error) {
        console.error('Supabase insert failed:', error);
        toast.error('Failed to save order request. Please try again.');
        if (btnSend) { btnSend.disabled = false; btnSend.textContent = 'Send order request'; }
        return;
      }
    } catch (e) {
      console.error('Order request error:', e);
      toast.error('Failed to save order request. Please try again.');
      if (btnSend) { btnSend.disabled = false; btnSend.textContent = 'Send order request'; }
      return;
    }

    // ===== guardar pedido no browser (fallback local) =====
    const ts = Date.now();
    try {
      const key = 'orderRequestsLocal';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      arr.unshift({ id: ts, dt: dt, content: out });
      localStorage.setItem(key, JSON.stringify(arr.slice(0, 200)));
    } catch (e) { }

    // ===== download =====
    const blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `order_request_${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);

    // ===== enviar email (EmailJS) =====
    if (window.emailjs) {
      emailjs.send(
        "service_cbus",
        "template_tdwabib",
        {
          order_id: ts,
          date_time: dt,
          order_text: out
        }
      ).catch(err => console.warn("EmailJS failed", err));
    }

    toast("We've received your order request and will get back to you shortly.");
    state.cart = [];
    renderCart();
    closeOrderModal();
    if (btnSend) { btnSend.disabled = false; btnSend.textContent = 'Send order request'; }
  }
  $('qtyDown').addEventListener('click', () => $('qtyInput').value = String(Math.max(1, parseInt($('qtyInput').value || '1', 10) - 1)));
  $('qtyUp').addEventListener('click', () => $('qtyInput').value = String(Math.max(1, parseInt($('qtyInput').value || '1', 10) + 1)));
  $('qtyInput').addEventListener('change', () => $('qtyInput').value = String(Math.max(1, parseInt($('qtyInput').value || '1', 10))));
  $('btnSend').addEventListener('click', () => {
    if (!state.cart.length) { toast.error('Your cart is empty!'); return; }
    renderCart();       // garante sync
    openOrderModal();   // ✅ agora abre modal (não envia)
  });

  $('btnAdd').addEventListener('click', () => {
    if (!state.selected) return;
    const qty = Math.max(1, parseInt($('qtyInput').value || '1', 10));
    const existing = state.cart.find(x => x.partNo === state.selected.partNo);
    if (existing) existing.qty += qty;
    else state.cart.push({ partNo: state.selected.partNo, desc: state.selected.desc, price: state.selected.price, qty });
    renderCart(); toast('Adicionado ao carrinho.');
  });
  $('btnOpenSub').addEventListener('click', () => {
    if (!state.selected?.hasSub) return;

    // 👉 guardar descrição do subassembly que vais abrir
    try {
      sessionStorage.setItem(
        `pnDesc:${state.selected.partNo}`,
        state.selected.desc || ''
      );
    } catch { }

    const next = [...state.path, state.selected.partNo].join('/');
    window.location.hash = '#/' + next;
  });

  // modal: fechar
  $('btnModalClose')?.addEventListener('click', closeOrderModal);

  $('orderModal')?.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close === '1') closeOrderModal();
  });

  // modal: send
  $('btnModalSend')?.addEventListener('click', () => sendOrderRequest());

  // tecla ESC fecha
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = $('orderModal');
      if (m && !m.hidden) closeOrderModal();
    }
  });
}

async function setSelected(partNo, desc, qty) {
  const tw = $('thumbWrap'); tw.innerHTML = '';
  const tryHead = async (url) => { try { const h = await fetch(url, { method: 'HEAD' }); return h.ok ? url : null; } catch { return null; } };

  // Update UI immediately — don't wait for network
  state.selected = { partNo, desc, qty, price: 'TBA', hasSub: false };
  $('selTitle').textContent = desc || '(sem descrição)';
  $('selPn').textContent = `P/N: ${partNo}`;
  $('selQty').textContent = qty ? `Used quantity: ${qty}` : '';
  $('btnAdd').disabled = false;
  $('btnOpenSub').disabled = true; // will update once HEAD resolves

  // Fire both HEAD requests in parallel
  const [thumbResult, subResult] = await Promise.allSettled([
    tryHead(thumbUrl(partNo)),
    tryHead(svgUrl(partNo)),
  ]);

  const imgUrl = thumbResult.value || thumbDefaultUrl();
  const img = document.createElement('img');
  img.src = imgUrl;
  img.alt = partNo;
  tw.appendChild(img);

  state.selected.hasSub = subResult.value != null;
  $('btnOpenSub').disabled = !state.selected.hasSub;
}

/* ---- Robust mapping: hotspot bbox -> nearest partNo text in BOM table ---- */

function parseBOMTokens(doc) {
  // Read BOM table text tokens in document order.
  // Supports multiple BOM tables (repeated headers) and non-5A part numbers (e.g., 700xxxx, TBA).
  const nodes = Array.from(doc.querySelectorAll('text'))
    .map(t => (t.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Find all header occurrences: Pos. | Part No | Qty. | Description
  const headers = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const c = nodes[i + 2];
    const d = nodes[i + 3];
    // Variant where "Part" "No" are split
    const e = nodes[i + 4];

    const isPos = a === 'Pos.' || a.toLowerCase() === 'pos.' || a.toLowerCase() === 'pos';
    const isQty = (x) => x && (x === 'Qty.' || x.toLowerCase() === 'qty.' || x.toLowerCase() === 'qty');
    const isDesc = (x) => x && x.toLowerCase() === 'description';
    const isPartNo = (x) => x && x.toLowerCase() === 'part no';
    const isPart = (x) => x && x.toLowerCase() === 'part';
    const isNo = (x) => x && x.toLowerCase() === 'no';

    if (isPos && isPartNo(b) && isQty(c) && isDesc(d)) {
      headers.push({ idx: i, headerLen: 4 });
      continue;
    }
    if (isPos && isPart(b) && isNo(c) && isQty(d) && isDesc(e)) {
      headers.push({ idx: i, headerLen: 5 });
      continue;
    }
  }
  if (!headers.length) return [];

  const rowsByPos = new Map();

  for (const h of headers) {
    const tail = nodes.slice(h.idx + h.headerLen);

    // Find first plausible row: <pos:int> <partNo:any> <qty:int> <desc:any>
    let start = -1;
    for (let i = 0; i < tail.length - 3; i++) {
      const pos = tail[i];
      const partNo = tail[i + 1];
      const qty = tail[i + 2];
      const desc = tail[i + 3];
      if (/^\d+$/.test(pos) && /^\d+$/.test(qty) && partNo && desc) {
        start = i; break;
      }
      // stop if we hit another header
      if ((pos === 'Pos.' || (pos || '').toLowerCase() === 'pos.' || (pos || '').toLowerCase() === 'pos') && i > 0) break;
    }
    if (start < 0) continue;

    for (let i = start; i < tail.length - 3;) {
      const pos = tail[i];
      const partNoRaw = tail[i + 1];
      const qty = tail[i + 2];
      const desc = tail[i + 3];

      if (!/^\d+$/.test(pos) || !/^\d+$/.test(qty) || !partNoRaw || !desc) break;

      const partNo = partNoRaw.replace(/\s+/g, '');
      // Keep first occurrence per pos (tables are split, not duplicated)
      if (!rowsByPos.has(pos)) {
        rowsByPos.set(pos, { pos, partNo, qty, desc });
      }

      i += 4;

      // Stop if we appear to have left the table (e.g., hit another header/legend)
      if (i < tail.length) {
        const nxt = tail[i];
        if (!/^\d+$/.test(nxt)) break;
      }
    }
  }

  return Array.from(rowsByPos.values()).sort((a, b) => Number(a.pos) - Number(b.pos));
}



function collectPartTextBoxes(doc) {
  const rePN = /^5A/i;
  const out = [];
  for (const t of Array.from(doc.querySelectorAll('text'))) {
    const s = (t.textContent || '').trim().replace(/\s+/g, '');
    if (!rePN.test(s)) continue;
    try {
      const bb = t.getBBox();
      out.push({ partNo: s, bb, el: t, cy: bb.y + bb.height / 2 });
    } catch { }
  }
  return out;
}

function collectHotspots(doc) {
  const out = [];
  for (const el of Array.from(doc.querySelectorAll('[id^="hotspot."]'))) {
    const m = String(el.id).match(/^hotspot\.(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isNaN(n)) continue;
    try {
      const bb = el.getBBox();
      out.push({ n, id: el.id, bb, cy: bb.y + bb.height / 2, cx: bb.x + bb.width / 2 });
    } catch { }
  }
  return out;
}

function dist(a, b) { return Math.abs(a - b); }

function buildMapFromGeometry(doc) {
  state.bomRows = parseBOMTokens(doc);
  state.rowsByPos = new Map(state.bomRows.map(r => [Number(r.pos), r]));

  const partBoxes = collectPartTextBoxes(doc);
  const hotspots = collectHotspots(doc);

  const map = new Map();

  // 1) Prefer deterministic mapping by "Pos." when possible: hotspot.N -> BOM pos (N+1)
  let posHits = 0;
  for (const h of hotspots) {
    const row = state.bomRows.find(r => r.pos === String(h.n + 1));
    if (row) { map.set(h.n, row); posHits++; }
  }
  if (hotspots.length && (posHits / hotspots.length) >= 0.75) {
    state.map = map;
    toast(`map ok (pos): ${map.size} hotspots`);
    return;
  }

  // 2) Otherwise fall back to geometry matching to nearest Part No text box
  map.clear();
  // For each hotspot: choose closest partNo text by vertical proximity, with mild x constraint
  for (const h of hotspots) {
    let best = null;
    let bestScore = Infinity;
    for (const p of partBoxes) {
      const dy = dist(h.cy, p.cy);
      const pcx = p.bb.x + p.bb.width / 2;
      const dx = Math.abs(pcx - h.cx);
      const score = dy * 1.0 + dx * 0.35;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    if (best) {
      const row = state.bomRows.find(r => r.partNo === best.partNo) || null;
      if (row) map.set(h.n, row);
    }
  }

  // 3) Final fallback: try pos mapping even if coverage was low
  const uniqPN = new Set(Array.from(map.values()).map(r => r.partNo));
  if (map.size === 0 || uniqPN.size < Math.max(1, Math.floor(state.bomRows.length * 0.6))) {
    map.clear();
    for (const h of hotspots) {
      const row = state.bomRows.find(r => r.pos === String(h.n + 1));
      if (row) map.set(h.n, row);
    }
  }

  state.map = map;
  toast(`map ok: ${map.size} hotspots`);
}

function buildHotspotToPosMap(doc) {
  // Works entirely in SVG coordinates (getBBox) to avoid CTM/scaling issues.
  const svg = doc.documentElement;
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const low = (s) => (s || '').toLowerCase();

  function bboxOf(el) {
    try { return el.getBBox(); } catch { return null; }
  }

  function median(arr) {
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  const texts = Array.from(doc.querySelectorAll('text'));

  // --- 1) Find Pos. header and validate full BOM header row ---
  const posHeaders = texts.filter(t => {
    const s = txt(t);
    return s === 'Pos.' || low(s) === 'pos.' || low(s) === 'pos';
  });

  function findNearestOnSameRowSvg(baseBb, labelSet) {
    const baseCy = baseBb.y + baseBb.height / 2;
    let best = null, bestScore = Infinity;
    for (const t of texts) {
      const s = low(txt(t));
      if (!labelSet.has(s)) continue;
      const bb = bboxOf(t);
      if (!bb) continue;
      const cy = bb.y + bb.height / 2;
      if (Math.abs(cy - baseCy) > baseBb.height * 1.5) continue;
      if (bb.x <= baseBb.x + baseBb.width - 1) continue;
      const score = bb.x - (baseBb.x + baseBb.width);
      if (score < bestScore) { bestScore = score; best = { el: t, bb }; }
    }
    return best;
  }

  const tables = [];
  for (const cand of posHeaders) {
    const bbPos = bboxOf(cand);
    if (!bbPos) continue;

    const part = findNearestOnSameRowSvg(bbPos, new Set(['part no', 'partno']));
    const qty  = findNearestOnSameRowSvg(bbPos, new Set(['qty.', 'qty']));
    const desc = findNearestOnSameRowSvg(bbPos, new Set(['description']));
    if (!part || !qty || !desc) continue;

    const posColCx = bbPos.x + bbPos.width / 2;
    const yStart   = bbPos.y + bbPos.height + 0.5;
    const tolX     = Math.max(3, bbPos.width * 1.5);

    // Collect Pos. cells below the header
    const posCells = [];
    for (const t of texts) {
      const s = txt(t);
      if (!/^\d+$/.test(s)) continue;
      const bb = bboxOf(t);
      if (!bb) continue;
      const cx = bb.x + bb.width / 2;
      const cy = bb.y + bb.height / 2;
      if (Math.abs(cx - posColCx) > tolX) continue;
      if (cy <= yStart) continue;
      posCells.push({ pos: Number(s), cy });
    }
    if (!posCells.length) continue;

    posCells.sort((a, b) => a.cy - b.cy || a.pos - b.pos);
    const seen = new Set();
    const rows = [];
    for (const c of posCells) {
      if (seen.has(c.pos)) continue;
      seen.add(c.pos);
      rows.push(c);
    }

    const deltas = [];
    for (let i = 1; i < rows.length; i++) {
      const d = rows[i].cy - rows[i - 1].cy;
      if (d > 0.5) deltas.push(d);
    }
    const rowH = deltas.length ? median(deltas) : 5;

    tables.push({
      posColCx,
      yStart,
      rowH,
      rows,
      y0: rows[0].cy - rowH,
      y1: rows[rows.length - 1].cy + rowH,
      closestPosByY: (y) => {
        let best = null, bestDy = Infinity;
        for (const r of rows) {
          const dy = Math.abs(y - r.cy);
          if (dy < bestDy) { bestDy = dy; best = r.pos; }
        }
        return bestDy <= rowH * 0.75 ? best : null;
      }
    });
  }

  if (!tables.length) return new Map();

  // --- 2) Parse hotspot path sub-rectangles (SVG coords) ---
  function bboxesFromPathD(d) {
    const parts = String(d || '').split('M').slice(1);
    const bbs = [];
    for (const part of parts) {
      const seg = 'M' + part;
      const nums = (seg.match(/[-+]?(?:\d*\.\d+|\d+)/g) || []).map(Number);
      if (nums.length < 4) continue;
      const xs = [], ys = [];
      for (let i = 0; i < nums.length; i += 2) {
        xs.push(nums[i]);
        if (i + 1 < nums.length) ys.push(nums[i + 1]);
      }
      if (!xs.length || !ys.length) continue;
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      bbs.push({ x0, y0, x1, y1, w: x1-x0, h: y1-y0, cx: (x0+x1)/2, cy: (y0+y1)/2 });
    }
    return bbs;
  }

  // --- 3) Match hotspot bands to BOM rows entirely in SVG coords ---
  const globalRowH = median(tables.map(t => t.rowH));
  const thinMax = Math.max(1, globalRowH * 1.1);
  const wideMin = Math.max(5,  globalRowH * 3.0);

  const map = new Map();
  const hotspots = Array.from(doc.querySelectorAll('g[id^="hotspot."]'));

  for (const g of hotspots) {
    const id = g.id || '';
    const n = Number(id.split('.')[1]);
    if (!Number.isFinite(n)) continue;

    const p = g.querySelector('path');
    if (!p) continue;
    const bbs = bboxesFromPathD(p.getAttribute('d') || '');
    if (!bbs.length) continue;

    let bestPos = null;
    let bestScore = Infinity;

    for (const bb of bbs) {
      if (bb.h > thinMax) continue;
      if (bb.w < wideMin) continue;

      // Find closest table by X (SVG coords)
      let bestTable = null, bestDx = Infinity;
      for (const t of tables) {
        const dx = Math.abs(bb.cx - t.posColCx);
        if (dx < bestDx) { bestDx = dx; bestTable = t; }
      }
      if (!bestTable) continue;
      if (bb.cy < bestTable.y0 - bestTable.rowH || bb.cy > bestTable.y1 + bestTable.rowH) continue;

      const pos = bestTable.closestPosByY(bb.cy);
      if (pos == null) continue;

      const yRow = bestTable.rows.find(r => r.pos === pos)?.cy ?? bb.cy;
      const score = bestDx * 0.4 + Math.abs(bb.cy - yRow) + bb.h * 3 - bb.w * 0.02;
      if (score < bestScore) { bestScore = score; bestPos = pos; }
    }

    if (bestPos != null) map.set(n, bestPos);
  }

  return map;
}

function extractHotspotNFromAttr(attr) {
  const m = String(attr || '').match(/ShowHotSpot\(evt,\s*(?:'|&apos;)?(\d+)(?:'|&apos;)?\)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}
function findHotspotNOnAncestors(el) {
  let cur = el;
  while (cur && cur !== cur.ownerDocument) {
    if (cur && cur.id) {
      const ni = extractHotspotNFromId(cur.id);
      if (ni !== null) return ni;
    }
    if (cur.getAttribute) {
      const om = cur.getAttribute('onmouseover') || cur.getAttribute('onmousemove') || '';
      const n = extractHotspotNFromAttr(om);
      if (n !== null) return n;
    }
    cur = cur.parentNode;
  }
  return null;
}

function extractHotspotNFromId(id) {
  const m = String(id || '').match(/hotspot[._-](\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Fallback: infer hotspot number from click position (works even when the event
 * target isn't inside the hotspot overlay / onmouseover isn't present).
 * Strategy: scan all hotspot groups and pick the smallest bounding rect that
 * contains the click point (client coords).
 */
function findHotspotNByPoint(doc, clientX, clientY) {
  const groups = Array.from(doc.querySelectorAll('g[id^="hotspot."], g[id^="hotspot_"], g[id^="hotspot-"]'));
  let best = null;
  let bestArea = Infinity;

  for (const g of groups) {
    const n = extractHotspotNFromId(g.id);
    if (n == null) continue;

    // Use boundingClientRect (screen coords) so we don't care about transforms/CTM.
    const r = g.getBoundingClientRect?.();
    if (!r) continue;

    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      // prefer tighter hit (smallest area) to avoid selecting large container groups
      if (area > 0 && area < bestArea) {
        bestArea = area;
        best = n;
      }
    }
  }
  return best;
}

function wireBridge() {
  // With inline SVG the document IS the main document — no contentDocument needed.
  const svgEl = $('svgViewport').querySelector('svg.inlineSvg');
  if (!svgEl) return;

  // Wrap in a doc-like object so parseBOMTokens / collectHotspots /
  // buildHotspotToPosMap etc. (all call doc.querySelectorAll) keep working unchanged.
  const doc = {
    documentElement: svgEl,
    querySelectorAll: (sel) => svgEl.querySelectorAll(sel),
    querySelector:    (sel) => svgEl.querySelector(sel),
    addEventListener: (type, fn, opts) => svgEl.addEventListener(type, fn, opts),
  };

  // build mapping from actual geometry
  state.map = buildMapFromGeometry(doc);

  // build hotspot -> POS mapping using callout numbers
  state.hotspotToPos = buildHotspotToPosMap(doc);

  state.lastHotspotN = null;

  svgEl.addEventListener('mouseover', (ev) => {
    const n = findHotspotNOnAncestors(ev.target);
    if (n !== null) state.lastHotspotN = n;
  }, true);

  svgEl.addEventListener('click', (ev) => {
    if (window.spaceDown || window.dragging) return; // don't select while panning
    const directN = findHotspotNOnAncestors(ev.target);
    const pointN = (directN === null && state.lastHotspotN == null)
      ? findHotspotNByPoint(doc, ev.clientX, ev.clientY)
      : null;
    const n = (directN !== null) ? directN
      : (state.lastHotspotN != null) ? state.lastHotspotN
      : pointN;
    if (n === null) return;

    const pos = state.hotspotToPos?.get(n);
    if (pos == null) return;

    const row = state.rowsByPos?.get(Number(pos));
    if (!row) return;

    setSelected(row.partNo, row.desc, row.qty);
  }, true);
}

function showSvgError(msg) {
  $('svgLoading').style.display = 'none';
  const b = $('svgErr');
  b.style.display = 'block';
  b.textContent = msg;
}

async function loadSvg(url) {
  const viewport = $('svgViewport');
  const loading = $('svgLoading');
  const err = $('svgErr');
  err.style.display = 'none';
  loading.style.display = 'block';

  zoomReset();

  // Hide the <object> placeholder and remove any previously injected inline SVG
  const objEl = document.getElementById('svgObj');
  if (objEl) objEl.style.display = 'none';
  const old = viewport.querySelector('svg.inlineSvg');
  if (old) old.remove();

  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const svgText = await res.text();

    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
    const parseErr = svgDoc.querySelector('parsererror');
    if (parseErr) throw new Error('SVG parse error');

    const svgEl = svgDoc.documentElement;

    // Make it fill the viewport and be identifiable
    svgEl.classList.add('inlineSvg');
    svgEl.style.width = '100%';
    svgEl.style.height = '100%';
    svgEl.style.display = 'block';

    // Ensure viewBox exists (create from width/height attrs if missing),
    // then remove width/height attrs so CSS controls sizing.
    if (!svgEl.hasAttribute('viewBox')) {
      const w = parseFloat(svgEl.getAttribute('width')) || 0;
      const h = parseFloat(svgEl.getAttribute('height')) || 0;
      if (w && h) svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');

    viewport.appendChild(svgEl);
    loading.style.display = 'none';

    // Small delay so layout is settled before geometry queries (getBBox, getBoundingClientRect)
    await new Promise(r => setTimeout(r, 80));

    // Execute SVG-internal scripts (DOMParser does not run them automatically).
    // We inject them as real <script> tags into the document head so that
    // inline onmouseover/onclick attrs (which run in window scope) can find the functions.
    for (const sc of Array.from(svgEl.querySelectorAll('script'))) {
      try {
        const tag = document.createElement('script');
        tag.textContent = sc.textContent;
        document.head.appendChild(tag);
      } catch (e) {
        console.warn('SVG script inject failed', e);
      }
    }

    try {
      wireBridge();
    } catch (e) {
      toast.error('map falhou');
    }

    // ✅ Apply pending selection from Search page (auto-select + full breadcrumb path)
    try {
      const raw = sessionStorage.getItem('searchJump');
      if (raw) {
        const j = JSON.parse(raw);
        const current = state.path?.length ? state.path[state.path.length - 1] : null;

        if (j && j.svgBase && current && canonSvgBase(j.svgBase) === canonSvgBase(current)) {
          if (Array.isArray(j.path) && j.path.length >= 2) {
            const rootCode = j.path[0];
            const rest = j.path.slice(1);
            state.path = [canonSvgBase(`pai_${rootCode}`), ...rest.map(canonSvgBase)];

            try {
              history.replaceState(null, '', '#/' + state.path.join('/'));
            } catch {
              location.hash = '#/' + state.path.join('/');
            }

            try {
              const map = state.searchMeta?.codeDesc || {};
              for (const pn of state.path) {
                const codeKey = pn.replace(/^pai_/i, '');
                const desc = map[normPartNo(codeKey)] || (pn.match(/^pai_/i) ? 'Root assembly' : '');
                if (desc) sessionStorage.setItem(`pnDesc:${pn}`, desc);
              }
            } catch { }

            renderCrumbs();
          }

          setSelected(j.partNo, j.desc, j.qty);
          const q = parseInt(j.qty || '1', 10);
          if (!Number.isNaN(q) && q > 0) $('qtyInput').value = String(q);
          sessionStorage.removeItem('searchJump');
        }
      }
    } catch { }

  } catch (e) {
    showSvgError('Erro a carregar SVG: ' + e.message);
    throw e;
  }
}

async function route() {
  const hash = window.location.hash || '#/';
  const pathStr = hash.replace(/^#\//, '').trim();
  state.path = pathStr ? pathStr.split('/').filter(Boolean).map(canonSvgBase) : [];
  renderCrumbs();
  clearSelected();
  renderCart();

  const last = state.path.length ? canonSvgBase(state.path[state.path.length - 1]) : null;
  const url = last ? svgUrl(last) : svgUrl(`pai_${state.catalog.pai_code}`);
  await loadSvg(url);
}

async function main() {
  await loadCatalog();
  await loadSearchMeta();
  setupUI();
  renderCrumbs();
  clearSelected();
  renderCart();

  window.addEventListener('hashchange', () => route().catch(() => { }));
  await route().catch(() => { });
}

main();

let zoom = 1;
const ZOOM_STEP = 0.25;
const ZOOM_MAX = 4;
const ZOOM_MIN = 1;

const viewport = document.getElementById('svgViewport');
function getSvgEl() { return viewport.querySelector('svg.inlineSvg'); }
const panHint = document.getElementById('panHint');

function applyZoom() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;

  // aumentar o object cria área de scroll real
  const _az = getSvgEl(); if (_az) { _az.style.width = (w * zoom) + "px"; _az.style.height = (h * zoom) + "px"; }

  viewport.classList.toggle('canPan', zoom !== 1);

  // 🔑 garante coerência
  syncZoomState();
}

function zoomIn() {
  zoom = Math.min(ZOOM_MAX, +(zoom + ZOOM_STEP).toFixed(2));
  applyZoom();
}
function zoomOut() {
  zoom = Math.max(ZOOM_MIN, +(zoom - ZOOM_STEP).toFixed(2));
  if (zoom === 1) zoomReset();
  else applyZoom();
}

function zoomReset() {
  zoom = 1;
  const _zr = getSvgEl(); if (_zr) { _zr.style.width = "100%"; _zr.style.height = "100%"; }
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
  viewport.classList.remove('canPan');

  // 🔑 garante coerência
  syncZoomState();
}

function syncZoomState() {
  // Se zoom está activo, GARANTE object escalado + canPan
  if (zoom !== 1) {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;

    const wantW = (w * zoom) + "px";
    const wantH = (h * zoom) + "px";

    // se alguém te “desfez” o tamanho, repõe
    const _s1 = getSvgEl(); if (_s1) { if (_s1.style.width !== wantW) _s1.style.width = wantW; if (_s1.style.height !== wantH) _s1.style.height = wantH; }

    viewport.classList.add('canPan');

  } else {
    // zoom 1: garante estado limpo
    viewport.classList.remove('canPan');
    const _s2 = getSvgEl(); if (_s2) { if (_s2.style.width && _s2.style.width !== "100%") _s2.style.width = "100%"; if (_s2.style.height && _s2.style.height !== "100%") _s2.style.height = "100%"; }

  }
}

// LISTENERS DO WATCHDOG (aqui)
viewport.addEventListener('mouseenter', syncZoomState);
viewport.addEventListener('mousedown', syncZoomState, true);
window.addEventListener('focus', syncZoomState);
window.addEventListener('resize', () => {
  if (zoom !== 1) syncZoomState();
});

document.getElementById('btnZoomOut').addEventListener('click', zoomOut);
document.getElementById('btnZoomIn').addEventListener('click', zoomIn);
document.getElementById('btnZoomReset').addEventListener('click', zoomReset);

// Zoom com mousewheel quando o ponteiro está sobre o viewport do SVG
viewport.addEventListener('wheel', (e) => {
  // só quando o rato está mesmo no viewport (já está, porque o listener é no viewport)
  e.preventDefault();

  // deltaY > 0 = roda para baixo (zoom out), deltaY < 0 = roda para cima (zoom in)
  if (e.deltaY < 0) zoomIn();
  else zoomOut();
}, { passive: false });


window.addEventListener('resize', () => {
  if (zoom !== 1) applyZoom();
});

// quando trocares o data="" para um SVG novo, isto garante zoom consistente

// ---- PAN controller (reutilizável) ----
const pan = (() => {
  const viewport = document.getElementById('svgViewport');

  let overlay = document.getElementById('panOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'panOverlay';
    overlay.className = 'panOverlay';
    viewport.appendChild(overlay);
  }

  let spaceDown = false;
  let dragging = false;
  let startX = 0, startY = 0;
  let startSL = 0, startST = 0;

  function syncPanState() {
    window.spaceDown = spaceDown;
    window.dragging = dragging;
  }

  function setCursor() {
    overlay.style.cursor = dragging ? 'grabbing' : (spaceDown ? 'grab' : '');
  }

  function down() {
    spaceDown = true;
    syncPanState();
    overlay.style.pointerEvents = 'auto';
    viewport.classList.add('isPanning');
    setCursor();
  }

  function up() {
    spaceDown = false;
    dragging = false;
    syncPanState();
    overlay.style.pointerEvents = 'none';
    viewport.classList.remove('isPanning');
    setCursor();
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function onKeyDown(e) {
    if (e.code !== 'Space') return;
    if (isTypingTarget(document.activeElement)) return;
    if (!spaceDown) down();
    e.preventDefault();
  }

  function onKeyUp(e) {
    if (e.code !== 'Space') return;
    if (isTypingTarget(document.activeElement)) return;
    up();
    e.preventDefault();
  }

  // impedir o mini-menu / seleção do Edge enquanto pan
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  viewport.addEventListener('contextmenu', (e) => {
    if (spaceDown || dragging) e.preventDefault();
  });
  document.addEventListener('selectstart', (e) => {
    if (spaceDown || dragging) e.preventDefault();
  }, true);

  // mouse drag (só quando spaceDown)
  overlay.addEventListener('mousedown', (e) => {
    if (!spaceDown || e.button !== 0) return;
    dragging = true;
    syncPanState();
    startX = e.clientX; startY = e.clientY;
    startSL = viewport.scrollLeft; startST = viewport.scrollTop;
    setCursor();
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    viewport.scrollLeft = startSL - (e.clientX - startX);
    viewport.scrollTop = startST - (e.clientY - startY);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    syncPanState();
    setCursor();
  });

  window.addEventListener('blur', up);
  document.addEventListener('visibilitychange', () => { if (document.hidden) up(); });

  // listeners no documento principal
  window.addEventListener('keydown', onKeyDown, { passive: false, capture: true });
  window.addEventListener('keyup', onKeyUp, { passive: false, capture: true });

  // estado inicial
  overlay.style.pointerEvents = 'none';
  syncPanState();
  setCursor();

  return { onKeyDown, onKeyUp, up };
})();
// ============================================================
// SEARCH MODAL
// ============================================================
(function () {
  let INDEX = null;
  let SEARCH_READY = false;
  let searchTmr = null;

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normPart(s) {
    return String(s || '').replace(/[\s\-_]/g, '').toUpperCase();
  }

  function getPathsForAssembly(code) {
    const key = normPart(code);
    return (INDEX?.pathsToRoot || {})[key] || [];
  }

  function tokenize(q) {
    return String(q || '').trim().split(/\s+/).filter(Boolean);
  }

  function isDigitsOnly(t) { return /^\d+$/.test(t); }

  function validateTokens(tokens) {
    const multi = tokens.length >= 2;
    const valid = [], ignored = [];
    for (const t of tokens) {
      if (!t) continue;
      if (!multi) {
        if (t.length >= 3) valid.push(t);
        else ignored.push({ t });
        continue;
      }
      if (isDigitsOnly(t)) {
        if (t.length >= 5) valid.push(t); else ignored.push({ t });
      } else {
        if (t.length >= 2) valid.push(t); else ignored.push({ t });
      }
    }
    return { valid, ignored };
  }

  function tokenMatchesEntry(entry, token) {
    const p = entry.partNoN || '', d = entry.descN || '';
    if (isDigitsOnly(token)) return p.includes(token) || d.includes(token);
    return d.includes(token.toLowerCase()) || p.includes(normPart(token));
  }

  function fieldMatches(entry, token, field) {
    const p = entry.partNoN || '', d = entry.descN || '';
    if (field === 'partNo') return isDigitsOnly(token) ? p.includes(token) : p.includes(normPart(token));
    return isDigitsOnly(token) ? d.includes(token) : d.includes(token.toLowerCase());
  }

  function buildHighlightedFragment(text, tokens, caseInsensitive = true) {
    const s = String(text || '');
    if (!s || !tokens.length) return document.createTextNode(s);
    const intervals = [];
    for (const t of tokens) {
      if (!t) continue;
      const re = new RegExp(escapeRegExp(t), caseInsensitive ? 'gi' : 'g');
      let m;
      while ((m = re.exec(s)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        intervals.push([m.index, m.index + m[0].length]);
      }
    }
    if (!intervals.length) return document.createTextNode(s);
    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const it of intervals) {
      if (!merged.length) { merged.push(it); continue; }
      const last = merged[merged.length - 1];
      if (it[0] <= last[1]) last[1] = Math.max(last[1], it[1]);
      else merged.push(it);
    }
    const frag = document.createDocumentFragment();
    let i = 0;
    for (const [a, b] of merged) {
      if (i < a) frag.appendChild(document.createTextNode(s.slice(i, a)));
      const strong = document.createElement('strong');
      strong.textContent = s.slice(a, b);
      frag.appendChild(strong);
      i = b;
    }
    if (i < s.length) frag.appendChild(document.createTextNode(s.slice(i)));
    return frag;
  }

  function getAssemblyDescFor(code) {
    const key = normPart(code);
    const map = INDEX?.codeDesc || null;
    if (!map) return { desc: '', missing: true };
    const desc = map[key];
    return { desc: desc || '', missing: !desc };
  }

  function isMissingAssemblyDesc(code) {
    const key = normPart(code);
    const list = INDEX?.missingCodeDesc;
    return Array.isArray(list) ? list.includes(key) : false;
  }

  function setSearchHeaderVisible(on) {
    const h = document.getElementById('searchResultsHeader');
    if (h) h.hidden = !on;
  }

  function setSearchStatus(msg) {
    const el = document.getElementById('searchStatus');
    if (!el) return;
    el.textContent = msg || '';
  }

  function renderSearchEmpty(msg) {
    setSearchHeaderVisible(false);
    const host = document.getElementById('searchResults');
    if (!host) return;
    host.innerHTML = msg ? `<div class="listEmpty">${msg}</div>` : '';
  }

  function buildHits(validTokens) {
    const entries = INDEX?.entries || [];
    const hits = [];
    for (const e of entries) {
      let ok = true;
      for (const t of validTokens) {
        if (!tokenMatchesEntry(e, t)) { ok = false; break; }
      }
      if (!ok) continue;
      const partTokens = validTokens.filter(t => fieldMatches(e, t, 'partNo'));
      const descTokens = validTokens.filter(t => fieldMatches(e, t, 'desc'));
      const paths = getPathsForAssembly(e.code);
      const effectivePaths = paths.length ? paths : [[]];
      if (partTokens.length) {
        for (const p of effectivePaths) hits.push({ svgBase: e.svgBase, code: e.code, path: p, matchField: 'partNo', previewText: e.partNo, highlightTokens: partTokens, partNo: e.partNo, desc: e.desc, qty: e.qty ?? null });
      }
      if (descTokens.length) {
        for (const p of effectivePaths) hits.push({ svgBase: e.svgBase, code: e.code, path: p, matchField: 'desc', previewText: e.desc, highlightTokens: descTokens, partNo: e.partNo, desc: e.desc, qty: e.qty ?? null });
      }
    }
    hits.sort((a, b) => {
      if (a.matchField !== b.matchField) return a.matchField === 'partNo' ? -1 : 1;
      const c = String(a.code).localeCompare(String(b.code));
      return c !== 0 ? c : String(a.partNo).localeCompare(String(b.partNo));
    });
    return hits;
  }

  function renderHits(hits) {
    if (!hits.length) { renderSearchEmpty('No results.'); return; }
    setSearchHeaderVisible(true);
    const host = document.getElementById('searchResults');
    host.innerHTML = '';

    for (const h of hits) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'listRow searchRow';

      const thumb = document.createElement('img');
      thumb.className = 'searchThumb';
      thumb.alt = h.svgBase;
      thumb.src = thumbUrl(h.svgBase).replace('/thumb/', '/thumb/thumb_'); // reuse app's thumbUrl pattern
      // fallback: build it properly
      thumb.src = `${STORAGE_BASE}/${state.catalog?.pai_code}/thumb/thumb_${h.svgBase}.jpg`;
      thumb.onerror = () => { thumb.onerror = null; thumb.src = thumbDefaultUrl(); };

      const codeWrap = document.createElement('div');
      codeWrap.className = 'searchCodeWrap';

      const crumb = document.createElement('div');
      crumb.className = 'searchCrumb';
      const uiParts = (h.path && h.path.length) ? ['Catalog', ...h.path.slice(1)] : ['Catalog', h.code];
      for (let i = 0; i < uiParts.length; i++) {
        const seg = document.createElement('span');
        seg.className = 'crumbSeg' + (i === uiParts.length - 1 ? ' crumbHere' : '');
        seg.textContent = uiParts[i];
        crumb.appendChild(seg);
        if (i !== uiParts.length - 1) {
          const sep = document.createElement('span');
          sep.className = 'crumbSep';
          sep.textContent = ' > ';
          crumb.appendChild(sep);
        }
      }
      codeWrap.appendChild(crumb);

      const { desc } = getAssemblyDescFor(h.code);
      const missing = isMissingAssemblyDesc(h.code) || !desc;
      const codeDescEl = document.createElement('div');
      codeDescEl.className = 'searchCodeDesc';
      codeDescEl.textContent = desc || (missing ? 'Missing description' : '');
      codeWrap.appendChild(codeDescEl);

      const prev = document.createElement('div');
      prev.className = 'searchPreview';
      prev.appendChild(buildHighlightedFragment(h.previewText, h.highlightTokens, h.matchField === 'desc'));

      row.append(thumb, codeWrap, prev);

      row.addEventListener('click', () => {
        try { sessionStorage.setItem('searchJump', JSON.stringify({ svgBase: h.svgBase, partNo: h.partNo, desc: h.desc, qty: h.qty, path: h.path || null })); } catch { }
        closeSearchModal();
        // navigate via hash — loadSvg will pick up searchJump
        window.location.hash = '#/' + encodeURIComponent(h.svgBase);
      });

      host.appendChild(row);
    }
  }

  function runSearch() {
    if (!SEARCH_READY) return;
    const q = document.getElementById('searchQ')?.value || '';
    const tokens = tokenize(q);
    if (!tokens.length) { setSearchStatus(''); renderSearchEmpty(''); return; }
    const { valid, ignored } = validateTokens(tokens);
    if (!valid.length) { setSearchStatus(''); renderSearchEmpty('Search terms are too short.'); return; }
    const hits = buildHits(valid);
    const ignoredMsg = ignored.length ? ('Ignored: ' + ignored.map(x => `'${x.t}'`).join(', ') + ' · ') : '';
    setSearchStatus(ignoredMsg + `${hits.length} results`);
    renderHits(hits);
  }

  function openSearchModal() {
    const m = document.getElementById('searchModal');
    if (!m) return;
    m.hidden = false;
    setTimeout(() => document.getElementById('searchQ')?.focus(), 50);
  }

  function closeSearchModal() {
    const m = document.getElementById('searchModal');
    if (!m) return;
    m.hidden = true;
  }

  async function initSearch() {
    // Wait for state.catalog to be populated (main() sets it)
    if (!state.catalog?.pai_code) return;

    const url = searchIndexUrl(); // reuse app.js's searchIndexUrl()
    if (!url) return;

    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load search index.');
      INDEX = await res.json();
      SEARCH_READY = true;
    } catch (e) {
      console.warn('Search index failed to load:', e);
    }
  }

  // Wire up UI — app.js is loaded dynamically so 'load' has already fired; bind directly
  (function bindSearchUI() {
    document.getElementById('btnSearch')?.addEventListener('click', openSearchModal);
    document.getElementById('btnSearchClose')?.addEventListener('click', closeSearchModal);

    document.getElementById('searchModal')?.addEventListener('click', (e) => {
      if (e.target?.dataset?.closeSearch) closeSearchModal();
    });

    document.getElementById('searchQ')?.addEventListener('input', () => {
      clearTimeout(searchTmr);
      searchTmr = setTimeout(runSearch, 80);
    });

    document.getElementById('searchQ')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
      if (e.key === 'Escape') closeSearchModal();
    });

    document.getElementById('searchClear')?.addEventListener('click', () => {
      const q = document.getElementById('searchQ');
      if (q) { q.value = ''; q.focus(); }
      setSearchStatus('');
      renderSearchEmpty('');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const m = document.getElementById('searchModal');
        if (m && !m.hidden) closeSearchModal();
      }
    });

    // Load index after catalog is ready
    const waitForCatalog = setInterval(() => {
      if (state.catalog?.pai_code) {
        clearInterval(waitForCatalog);
        initSearch();
      }
    }, 100);
  }());
})();