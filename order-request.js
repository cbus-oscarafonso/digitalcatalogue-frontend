// ── order-request.js — shared order request logic ────────────────────────────
// Loaded by both interactive-catalog.html and client-area.html.
// Depends on: window.sb (Supabase client), window.toast (toast.js)

// ── Cart grouping helper ──────────────────────────────────────────────────────
// Returns array of { catalogId, paiCode, catalogName, rows[] } preserving insertion order.
function buildCartGroups(cart) {
  const groups = [];
  const seen = new Map();
  cart.forEach((row, idx) => {
    const key = row.catalogId || '__none__';
    if (!seen.has(key)) {
      seen.set(key, groups.length);
      groups.push({ catalogId: row.catalogId, paiCode: row.paiCode, catalogName: row.catalogName, rows: [] });
    }
    groups[seen.get(key)].rows.push({ row, idx });
  });
  return groups;
}

function catalogDisplayName(group) {
  return group.paiCode && group.catalogName
    ? `${group.paiCode} — ${group.catalogName}`
    : group.catalogName || group.paiCode || 'Unknown catalog';
}

// ── Modal rendering ───────────────────────────────────────────────────────────
// Renders the full cart grouped by catalog into a modal body element.
// readOnly: true in client-area (no qty editing / remove buttons)
window.renderCartModalGrouped = function(bodyEl, cart, readOnly) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '';

  if (!cart || !cart.length) {
    const d = document.createElement('div');
    d.style.cssText = 'color:#6b7280;padding:16px;text-align:center;font-size:13px;';
    d.textContent = 'Your cart is empty. Go to the catalog to add items.';
    bodyEl.appendChild(d);
    return;
  }

  const groups = buildCartGroups(cart);
  const catalogCount = groups.length;

  if (catalogCount > 1) {
    const notice = document.createElement('div');
    notice.className = 'cartMultiNotice';
    notice.textContent = `This order request spans ${catalogCount} catalogs and will generate ${catalogCount} separate requests upon submission.`;
    bodyEl.appendChild(notice);
  }

  groups.forEach(group => {
    const label = document.createElement('div');
    label.className = 'cartCatalogLabel';
    label.textContent = catalogDisplayName(group);
    bodyEl.appendChild(label);

    group.rows.forEach(({ row, idx }) => {
      const r = document.createElement('div');
      r.className = 'cartRow';

      const pn    = document.createElement('div'); pn.className = 'pnCell';    pn.textContent = row.partNo;
      const desc  = document.createElement('div');                              desc.textContent = row.desc;
      const price = document.createElement('div'); price.className = 'priceCell'; price.textContent = row.price || 'TBA';

      if (readOnly) {
        // Read-only: static qty, no remove button
        const qty = document.createElement('div'); qty.textContent = String(row.qty);
        const empty = document.createElement('div');
        r.append(pn, desc, price, qty, empty);
      } else {
        // Editable: qty input + remove button
        const qty = document.createElement('input');
        qty.type = 'number'; qty.min = '1'; qty.value = String(row.qty);
        qty.addEventListener('change', () => {
          row.qty = Math.max(1, parseInt(qty.value || '1', 10));
          window.__syncCart && window.__syncCart();
        });

        const rm = document.createElement('button'); rm.className = 'rmBtn'; rm.textContent = '✕';
        rm.addEventListener('click', () => {
          window.__cartRemove && window.__cartRemove(idx);
        });

        r.append(pn, desc, price, qty, rm);
      }

      bodyEl.appendChild(r);
    });
  });
};

// ── content_text builder for a single catalog group ───────────────────────────
function buildGroupContentText(dt, group) {
  let out = '';
  out += 'Order request\n';
  out += `Date/time: ${dt}\n`;
  out += `Catalog: ${catalogDisplayName(group)}\n`;
  out += '\n';
  out += 'P/N | Description | Price | Qty\n';
  out += '--------------------------------\n';
  for (const { row } of group.rows) {
    out += `${row.partNo} | ${row.desc} | ${row.price || 'TBA'} | ${row.qty}\n`;
  }
  return out;
}

// ── Aggregated .txt for download and email (all catalogs in one document) ─────
function buildAggregatedText(dt, groups) {
  let out = '';
  out += 'Order request\n';
  out += `Date/time: ${dt}\n`;
  out += `Catalogs: ${groups.length}\n`;

  for (const group of groups) {
    out += '\n';
    out += `========================================\n`;
    out += `${catalogDisplayName(group)}\n`;
    out += `========================================\n`;
    out += 'P/N | Description | Price | Qty\n';
    out += '--------------------------------\n';
    for (const { row } of group.rows) {
      out += `${row.partNo} | ${row.desc} | ${row.price || 'TBA'} | ${row.qty}\n`;
    }
  }
  return out;
}

// ── Send order request ────────────────────────────────────────────────────────
// cart: array of cart items
// onSuccess: callback after successful send (clears cart, closes modal, etc.)
// btnEl: the send button element (for disabled state)
window.sendOrderRequest = async function(cart, onSuccess, btnEl) {
  if (!cart || !cart.length) { window.toast?.error('Your cart is empty!'); return; }

  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Sending…'; }

  const now = new Date();
  const dt  = now.toISOString().replace('T', ' ').slice(0, 19);

  const groups = buildCartGroups(cart);

  // Fetch session + customer_id once
  let userId     = null;
  let customerId = null;
  try {
    const { data: { session } } = await window.sb.auth.getSession();
    userId = session?.user?.id || null;
    if (userId) {
      const { data: prof } = await window.sb
        .from('profiles')
        .select('customer_id')
        .eq('user_id', userId)
        .maybeSingle();
      customerId = prof?.customer_id || null;
    }
  } catch (e) {
    console.error('Failed to fetch session/profile:', e);
    window.toast?.error('Failed to send order request. Please try again.');
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Send order request'; }
    return;
  }

  // Insert one order_request per catalog group
  let anyError = false;
  for (const group of groups) {
    const contentText = buildGroupContentText(dt, group);
    const { error } = await window.sb.from('order_requests').insert({
      user_id:      userId,
      content_text: contentText,
      catalog_id:   group.catalogId || null,
      customer_id:  customerId,
    });
    if (error) {
      console.error('Supabase insert failed:', error);
      anyError = true;
    }
  }

  if (anyError) {
    window.toast?.error('One or more order requests failed to save. Please try again.');
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Send order request'; }
    return;
  }

  // Download aggregated .txt
  const ts          = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const aggregated  = buildAggregatedText(dt, groups);
  const blob        = new Blob([aggregated], { type: 'text/plain;charset=utf-8' });
  const a           = document.createElement('a');
  a.href            = URL.createObjectURL(blob);
  a.download        = `order_request_${ts}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);

  window.toast?.('We\'ve received your order request and will get back to you shortly.');
  if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Send order request'; }
  onSuccess && onSuccess();
};
