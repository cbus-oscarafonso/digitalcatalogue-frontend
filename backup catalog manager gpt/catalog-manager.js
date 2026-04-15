// catalog-manager.js
//
// Handles the "Create New Catalog" and "Update Existing Catalog" tabs.
//
// Architecture notes:
//
//   • Vehicle association is handled by a reusable picker factory
//     (createVehiclePicker). Two instances are created — one for each tab —
//     each bound to its own set of DOM element ids. The underlying vehicle
//     list is fetched once and shared via vehiclesCache.
//
//   • All persistence of catalog + vehicle associations goes through the
//     atomic RPCs create_catalog_with_vehicles and update_catalog_and_vehicles.
//     The client never touches vehicle_catalogs or catalogs directly for
//     create/update — only for reads.
//
//   • A dirty tracker watches every editable field on both tabs. Attempting
//     to change tab, change selected catalog, or reload the page while dirty
//     pops a confirmation listing every changed field by name.
//
//   • The lock-button UX on the Update tab prevents accidentally un-associating
//     a vehicle: existing associations render disabled until the user clicks
//     the lock icon to unlock the checkbox.

const STORAGE_BASE = "https://ytwwcrhtcsdpqeualnsx.supabase.co/storage/v1/object/public/catalogs";
const BUCKET = "catalogs";

// ── Helpers ────────────────────────────────────────────────────────────────

function $id(id) { return document.getElementById(id); }

function esc(s) {
  return String(s || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function normPartNo(s) {
  return String(s || '').replace(/[\s\-_]/g, '').toUpperCase();
}

function normDesc(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function fmtDt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Modals ─────────────────────────────────────────────────────────────────

function showConfirm(html, onOk, { title = 'Confirm Catalog Submission', okText = 'Yes, submit', cancelText = 'Cancel' } = {}) {
  $id('confirmModalTitle').textContent = title;
  $id('confirmModalBody').innerHTML = html;
  $id('confirmModal').style.display = 'flex';
  const ok = $id('btnConfirmOk');
  const cancel = $id('btnConfirmCancel');
  ok.textContent = okText;
  cancel.textContent = cancelText;
  const cleanup = () => {
    $id('confirmModal').style.display = 'none';
    ok.onclick = null;
    cancel.onclick = null;
    ok.textContent = 'Yes, submit';
    cancel.textContent = 'Cancel';
    $id('confirmModalTitle').textContent = 'Confirm Catalog Submission';
  };
  ok.onclick = () => { cleanup(); onOk(); };
  cancel.onclick = cleanup;
}

// Warning modal — same widget as showConfirm, different wording/intent.
// Used for "unsaved changes" and "no vehicles → will be saved as draft" warnings.
function showWarning(title, bodyHtml, { okText, cancelText, onOk }) {
  const html = `
    <div style="display:flex;align-items:flex-start;gap:12px;">
      <div style="font-size:28px;line-height:1;flex:0 0 auto;">⚠️</div>
      <div style="flex:1;">
        <div style="font-size:14px;line-height:1.55;color:#111827;">${bodyHtml}</div>
      </div>
    </div>
  `;
  showConfirm(html, onOk, {
    title,
    okText: okText || 'Continue',
    cancelText: cancelText || 'Cancel',
  });
}

function showResult(title, html, isError = false) {
  $id('resultModalTitle').textContent = title;
  $id('resultModalTitle').style.color = isError ? '#b91c1c' : 'var(--blue)';
  $id('resultModalBody').innerHTML = html;
  $id('resultModal').style.display = 'flex';
  $id('btnResultOk').onclick = () => { $id('resultModal').style.display = 'none'; };
}

// ── Progress ───────────────────────────────────────────────────────────────

function setProgress(pct, label, step) {
  $id('progressWrap').style.display = 'block';
  $id('progressFill').style.width = pct + '%';
  if (label) $id('progressLabel').textContent = label;
  if (step !== undefined) $id('progressStep').textContent = step;
}

function hideProgress() {
  $id('progressWrap').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// VEHICLES — shared cache + picker factory
// ═══════════════════════════════════════════════════════════════════════════

// Cached vehicle list, shared between both pickers. Loaded once on page init.
let vehiclesCache = null;
let vehiclesCachePromise = null;

async function loadVehiclesOnce() {
  if (vehiclesCache) return vehiclesCache;
  if (vehiclesCachePromise) return vehiclesCachePromise;

  vehiclesCachePromise = (async () => {
    const { data, error } = await window.sb
      .from('vehicles')
      .select('id, pep_code, cobus_bus_no, vin, customer:customers(name)')
      .order('pep_code');

    if (error) {
      vehiclesCachePromise = null;
      throw new Error('Failed to load vehicles: ' + error.message);
    }

    vehiclesCache = (data || []).map(v => ({
      id: v.id,
      pep_code: v.pep_code || '',
      cobus_bus_no: v.cobus_bus_no || '',
      customer: v.customer?.name || '',
      vin: v.vin || '',
    }));
    return vehiclesCache;
  })();

  return vehiclesCachePromise;
}

// Find a pep_code by vehicle id — useful for change-log summaries.
function pepCodeFor(vehicleId) {
  if (!vehiclesCache) return vehicleId?.slice(0, 8) || '?';
  const v = vehiclesCache.find(x => x.id === vehicleId);
  return v?.pep_code || vehicleId?.slice(0, 8) || '?';
}

/**
 * createVehiclePicker — builds an isolated picker bound to a set of DOM ids.
 *
 * config: {
 *   tbodyId, selectAllId, selectedCountId, tableId,
 *   filterIds: { pep, busNo, customer, vin },
 *   mode: 'create' | 'update',
 *   onChange: () => void           // called on any selection change (for dirty tracking)
 * }
 */
function createVehiclePicker(config) {
  const state = {
    vehicles: [],   // [{ id, pep_code, ..., checked, associated, unlocked }]
    filters: { pep_code: '', cobus_bus_no: '', customer: '', vin: '' },
    sortCol: 'pep_code',
    sortDir: 'asc',
    originalAssociated: new Set(),
  };

  const { tbodyId, selectAllId, selectedCountId, tableId, filterIds, onChange } = config;
  const emit = () => { if (typeof onChange === 'function') onChange(); };

  function getFilteredSorted() {
    let rows = state.vehicles.filter(v =>
      v.pep_code.toLowerCase().includes(state.filters.pep_code) &&
      v.cobus_bus_no.toLowerCase().includes(state.filters.cobus_bus_no) &&
      v.customer.toLowerCase().includes(state.filters.customer) &&
      v.vin.toLowerCase().includes(state.filters.vin)
    );
    rows.sort((a, b) => {
      const va = String(a[state.sortCol] || '').toLowerCase();
      const vb = String(b[state.sortCol] || '').toLowerCase();
      return state.sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return rows;
  }

  function render() {
    const rows = getFilteredSorted();
    const tbody = $id(tbodyId);
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--gray);padding:20px;">No vehicles found.</td></tr>`;
      updateSelectedCount();
      return;
    }

    tbody.innerHTML = rows.map(v => {
      const associated = !!v.associated;
      const unlocked = !!v.unlocked;
      const rowCls = associated ? (unlocked ? 'assoc unlocked' : 'assoc') : '';
      const chkDisabled = associated && !unlocked ? 'disabled' : '';
      const unlockToggle = associated
        ? `<label class="assocToggle" title="${unlocked ? 'Toggle off to lock this row again' : 'Toggle on to unlock and allow un-associating'}">
       <input type="checkbox" class="assocUnlockToggle" data-id="${v.id}" ${unlocked ? 'checked' : ''}>
       <span class="assocToggleSlider"></span>
     </label>`
        : '';

      return `
  <tr class="${rowCls}">
    <td style="white-space:nowrap;">
      <input type="checkbox" data-id="${v.id}" ${v.checked ? 'checked' : ''} ${chkDisabled}>
      ${unlockToggle}
    </td>
    <td>${esc(v.pep_code)}</td>
    <td>${esc(v.cobus_bus_no)}</td>
    <td>${esc(v.customer)}</td>
    <td>${esc(v.vin)}</td>
  </tr>
`;
    }).join('');

    tbody.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.addEventListener('change', () => {
        const v = state.vehicles.find(x => x.id === chk.dataset.id);
        if (!v) return;
        if (v.associated && !v.unlocked) {
          chk.checked = true;
          return;
        }
        v.checked = chk.checked;
        updateSelectedCount();
        syncSelectAll();
        emit();
      });
    });

    tbody.querySelectorAll('.assocUnlockToggle').forEach(toggle => {
      toggle.addEventListener('change', () => {
        const v = state.vehicles.find(x => x.id === toggle.dataset.id);
        if (!v) return;
        v.unlocked = toggle.checked;
        render();
      });
    });

    updateSelectedCount();
    syncSelectAll();
  }

  function updateSelectedCount() {
    const n = state.vehicles.filter(v => v.checked).length;
    const el = $id(selectedCountId);
    if (el) el.textContent = n ? `${n} selected` : '';
  }

  function syncSelectAll() {
    const selectAll = $id(selectAllId);
    if (!selectAll) return;
    const visible = getFilteredSorted();
    const editable = visible.filter(v => !v.associated || v.unlocked);
    if (!editable.length) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      return;
    }
    const allChecked = editable.every(v => v.checked);
    const anyChecked = editable.some(v => v.checked);
    selectAll.checked = allChecked;
    selectAll.indeterminate = !allChecked && anyChecked;
  }

  function bindEvents() {
    const selectAll = $id(selectAllId);
    if (selectAll) {
      selectAll.addEventListener('change', (e) => {
        const visible = getFilteredSorted();
        visible.forEach(v => {
          if (!v.associated || v.unlocked) v.checked = e.target.checked;
        });
        render();
        emit();
      });
    }

    const filterMap = [
      [filterIds.pep, 'pep_code'],
      [filterIds.busNo, 'cobus_bus_no'],
      [filterIds.customer, 'customer'],
      [filterIds.vin, 'vin'],
    ];
    filterMap.forEach(([id, key]) => {
      const el = $id(id);
      if (!el) return;
      el.addEventListener('input', (e) => {
        state.filters[key] = e.target.value.toLowerCase();
        render();
      });
    });

    const table = $id(tableId);
    if (table) {
      table.querySelectorAll('th[data-col]').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.dataset.col;
          if (state.sortCol === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          else { state.sortCol = col; state.sortDir = 'asc'; }
          table.querySelectorAll('th[data-col]').forEach(t => {
            t.classList.remove('sorted');
            t.querySelector('.sortArrow').textContent = '↕';
          });
          th.classList.add('sorted');
          th.querySelector('.sortArrow').textContent = state.sortDir === 'asc' ? '↑' : '↓';
          render();
        });
      });
    }
  }

  function setData(vehicleList, associatedIds = []) {
    const assocSet = new Set(associatedIds);
    state.originalAssociated = new Set(associatedIds);
    state.vehicles = vehicleList.map(v => ({
      ...v,
      checked: assocSet.has(v.id),
      associated: assocSet.has(v.id),
      unlocked: false,
    }));
    state.filters = { pep_code: '', cobus_bus_no: '', customer: '', vin: '' };
    Object.values(filterIds).forEach(id => {
      const el = $id(id);
      if (el) el.value = '';
    });
    render();
  }

  function getCheckedIds() {
    return state.vehicles.filter(v => v.checked).map(v => v.id);
  }

  function getOriginalAssociatedIds() {
    return [...state.originalAssociated];
  }

  function hasChanges() {
    const checked = new Set(getCheckedIds());
    if (checked.size !== state.originalAssociated.size) return true;
    for (const id of checked) if (!state.originalAssociated.has(id)) return true;
    return false;
  }

  function reset() {
    setData(vehiclesCache || [], []);
  }

  return {
    bindEvents,
    setData,
    getCheckedIds,
    getOriginalAssociatedIds,
    hasChanges,
    reset,
  };
}

// ── Instantiate pickers ────────────────────────────────────────────────────

const createPicker = createVehiclePicker({
  tbodyId: 'vehicleTbody',
  selectAllId: 'chkSelectAll',
  selectedCountId: 'selectedCount',
  tableId: 'vehicleTable',
  filterIds: { pep: 'filterPep', busNo: 'filterBusNo', customer: 'filterCustomer', vin: 'filterVin' },
  mode: 'create',
});

const updatePicker = createVehiclePicker({
  tbodyId: 'uVehicleTbody',
  selectAllId: 'uChkSelectAll',
  selectedCountId: 'uSelectedCount',
  tableId: 'uVehicleTable',
  filterIds: { pep: 'uFilterPep2', busNo: 'uFilterBusNo2', customer: 'uFilterCustomer2', vin: 'uFilterVin2' },
  mode: 'update',
});

// ═══════════════════════════════════════════════════════════════════════════
// SVG TEXT + BOM PARSING  (unchanged from original)
// ═══════════════════════════════════════════════════════════════════════════

function extractSvgTextNodes(svgDoc) {
  const nodes = [];
  svgDoc.querySelectorAll('text').forEach(el => {
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt) nodes.push(txt);
  });
  return nodes;
}

function parseBomTokens(nodes) {
  const low = x => (x || '').toLowerCase();
  const isPos = x => x === 'Pos.' || low(x) === 'pos.' || low(x) === 'pos';
  const isQty = x => x === 'Qty.' || low(x) === 'qty.' || low(x) === 'qty';
  const isDesc = x => low(x) === 'description';
  const isPartNo = x => low(x) === 'part no';
  const isPart = x => low(x) === 'part';
  const isNo = x => low(x) === 'no';

  const headers = [];
  for (let i = 0; i < nodes.length; i++) {
    const [a, b, c, d, e] = [nodes[i], nodes[i + 1], nodes[i + 2], nodes[i + 3], nodes[i + 4]];
    if (isPos(a) && isPartNo(b) && isQty(c) && isDesc(d)) { headers.push({ idx: i, headerLen: 4 }); continue; }
    if (isPos(a) && isPart(b) && isNo(c) && isQty(d) && isDesc(e)) { headers.push({ idx: i, headerLen: 5 }); continue; }
  }
  if (!headers.length) return [];

  const rowsByPos = new Map();
  for (const h of headers) {
    const tail = nodes.slice(h.idx + h.headerLen);
    let start = -1;
    for (let i = 0; i < tail.length - 3; i++) {
      const [pos, partNo, qty, desc] = [tail[i], tail[i + 1], tail[i + 2], tail[i + 3]];
      if (/^\d+$/.test(pos) && /^\d+$/.test(qty) && partNo && desc) { start = i; break; }
      if (i > 0 && isPos(pos)) break;
    }
    if (start < 0) continue;

    let i = start;
    while (i < tail.length - 3) {
      const [pos, partRaw, qty, desc] = [tail[i], tail[i + 1], tail[i + 2], tail[i + 3]];
      if (!/^\d+$/.test(pos) || !/^\d+$/.test(qty) || !partRaw || !desc) break;
      const partNo = partRaw.replace(/\s+/g, '');
      if (!rowsByPos.has(pos)) rowsByPos.set(pos, { pos, partNo, qty, desc });
      i += 4;
      if (i < tail.length && !/^\d+$/.test(tail[i])) break;
    }
  }
  return Array.from(rowsByPos.values()).sort((a, b) => Number(a.pos) - Number(b.pos));
}

async function buildSearchIndex(paiCode, allSvgFiles) {
  const parser = new DOMParser();
  const entries = [];
  const allCodes = new Set();
  const rootCodes = new Set();

  for (const file of allSvgFiles) {
    const text = await file.text();
    const svgDoc = parser.parseFromString(text, 'image/svg+xml');
    const svgBase = file.name.replace(/\.svg$/i, '');
    const code = svgBase.match(/^pai_/i) ? svgBase.slice(4) : svgBase;
    const codeKey = normPartNo(code);

    if (svgBase.match(/^pai_/i)) rootCodes.add(codeKey);
    allCodes.add(codeKey);

    const nodes = extractSvgTextNodes(svgDoc);
    const bomRows = parseBomTokens(nodes);
    for (const r of bomRows) {
      entries.push({
        svgBase, code: codeKey, pos: r.pos, partNo: r.partNo, desc: r.desc, qty: r.qty,
        partNoN: normPartNo(r.partNo), descN: normDesc(r.desc),
      });
    }
  }

  const codeDesc = {};
  for (const e of entries) {
    const k = e.partNoN;
    const d = (e.desc || '').trim();
    if (k && d && !codeDesc[k]) codeDesc[k] = d;
  }
  for (const rc of rootCodes) if (!codeDesc[rc]) codeDesc[rc] = 'Root assembly';

  const missingCodeDesc = [...allCodes].filter(c => !codeDesc[c]).sort();

  const svgCodes = new Set(allCodes);
  const parentsOf = {};
  for (const e of entries) {
    const base = e.svgBase || '';
    const parentKey = normPartNo(base.match(/^pai_/i) ? base.slice(4) : base);
    const childKey = e.partNoN || '';
    if (!parentKey || !childKey || !svgCodes.has(childKey)) continue;
    if (!parentsOf[childKey]) parentsOf[childKey] = new Set();
    parentsOf[childKey].add(parentKey);
  }
  for (const rc of rootCodes) if (!parentsOf[rc]) parentsOf[rc] = new Set();
  const parentsOfJson = Object.fromEntries(
    Object.entries(parentsOf).map(([k, v]) => [k, [...v].sort()])
  );

  const MAX_PATHS = 500, MAX_DEPTH = 50;
  const cache = new Map();
  function pathsToNode(codeKey) {
    if (cache.has(codeKey)) return cache.get(codeKey);
    cache.set(codeKey, []);
    if (rootCodes.has(codeKey)) { cache.set(codeKey, [[codeKey]]); return [[codeKey]]; }
    const plist = parentsOfJson[codeKey] || [];
    if (!plist.length) { cache.set(codeKey, []); return []; }
    const out = [];
    for (const p of plist) {
      for (const pp of pathsToNode(p)) {
        if (pp.length >= MAX_DEPTH) continue;
        out.push([...pp, codeKey]);
        if (out.length >= MAX_PATHS) break;
      }
    }
    cache.set(codeKey, out);
    return out;
  }
  const pathsToRoot = {};
  for (const c of [...svgCodes].sort()) pathsToRoot[c] = pathsToNode(c);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    svgsIndexed: allSvgFiles.length,
    svgsWithBom: new Set(entries.map(e => e.svgBase)).size,
    rowsIndexed: entries.length,
    entries, codeDesc, missingCodeDesc,
    parentsOf: parentsOfJson, pathsToRoot,
  };
}

// ── Upload helper ──────────────────────────────────────────────────────────

async function uploadFile(path, file, contentType, upsert = false) {
  const { error } = await window.sb.storage
    .from(BUCKET)
    .upload(path, file, { contentType, upsert });
  if (error) throw new Error(`Upload failed for ${path}: ${error.message}`);
}

function mimeForFile(name) {
  if (/\.svg$/i.test(name)) return 'image/svg+xml';
  if (/\.png$/i.test(name)) return 'image/png';
  return 'image/jpeg';
}

// ═══════════════════════════════════════════════════════════════════════════
// DIRTY TRACKING
// ═══════════════════════════════════════════════════════════════════════════

// Create tab: dirty if any field has a non-empty value or any vehicle is checked.
const dirtyCreate = {
  getDirtyFields() {
    const fields = [];
    if ($id('fPaiCode').value.trim()) fields.push('PAI Code');
    if ($id('fName').value.trim()) fields.push('Name');
    if ($id('fDescription').value.trim()) fields.push('Description');
    if ($id('fParentSvg').files.length) fields.push('Parent Assembly SVG');
    if ($id('fSubSvgs').files.length) fields.push('Subassembly SVGs');
    if ($id('fThumbs').files.length) fields.push('Thumbnails');
    if (createPicker.getCheckedIds().length) fields.push('Vehicles');
    return fields;
  },
  isDirty() { return this.getDirtyFields().length > 0; },
  reset() {
    $id('fPaiCode').value = '';
    $id('fName').value = '';
    $id('fDescription').value = '';
    $id('fStatus').value = 'published';
    $id('fParentSvg').value = '';
    $id('fSubSvgs').value = '';
    $id('fThumbs').value = '';
    createPicker.reset();
  },
};

// Update tab: dirty if any editable field differs from the loaded snapshot,
// or any vehicle checkbox state differs from the original association.
const dirtyUpdate = {
  _snapshot: null,
  _ready: false,
  snapshotFrom(cat) {
    this._snapshot = {
      name: cat.name || '',
      description: cat.description || '',
      status: cat.status || '',
      note: '',
    };
    this._ready = true;
  },
  clearSnapshot() { this._snapshot = null; this._ready = false; },
  getDirtyFields() {
    if (!this._ready || !this._snapshot) return [];
    const fields = [];
    if ($id('uName').value.trim() !== this._snapshot.name) fields.push('Name');
    if ($id('uDescription').value.trim() !== this._snapshot.description) fields.push('Description');
    if ($id('uStatus').value !== this._snapshot.status) fields.push('Status');
    if ($id('uChangeNote').value.trim() !== this._snapshot.note) fields.push('Change Note');
    if ($id('uParentSvg').files.length) fields.push('Parent Assembly SVG');
    if ($id('uSubSvgs').files.length) fields.push('Subassembly SVGs');
    if ($id('uThumbs').files.length) fields.push('Thumbnails');
    if (updatePicker.hasChanges()) fields.push('Vehicles');
    return fields;
  },
  isDirty() { return this.getDirtyFields().length > 0; },
};

// Calls proceed() if it's safe (not dirty, or user confirms discard).
function guardNavigation(proceed) {
  const createActive = $id('tab-create').classList.contains('active');
  const tracker = createActive ? dirtyCreate : dirtyUpdate;
  const dirtyFields = tracker.getDirtyFields();

  if (!dirtyFields.length) { proceed(); return; }

  const list = dirtyFields.map(f => `<li>${esc(f)}</li>`).join('');
  showWarning(
    'Unsaved changes',
    `<p style="margin:0 0 10px;">You have unsaved changes in the following fields:</p>
     <ul style="margin:0 0 10px;padding-left:20px;font-weight:600;">${list}</ul>
     <p style="margin:0;">If you continue, these changes will be <strong>lost</strong>.</p>`,
    {
      okText: 'Discard changes',
      cancelText: 'Keep editing',
      onOk: proceed,
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.tabBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('active')) return;
    const target = btn.dataset.tab;
    guardNavigation(() => {
      document.querySelectorAll('.tabBtn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tabPanel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $id('tab-' + target).classList.add('active');

      if (target === 'update' && !updateTabLoaded) {
        updateTabLoaded = true;
        loadCatalogsForUpdate();
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATE TAB — validation + submit
// ═══════════════════════════════════════════════════════════════════════════

function validateCreate() {
  const errors = [];

  const paiCode = $id('fPaiCode').value.trim();
  const name = $id('fName').value.trim();
  const parentFile = $id('fParentSvg').files[0];
  const subFiles = Array.from($id('fSubSvgs').files);
  const thumbFiles = Array.from($id('fThumbs').files);
  const selectedVehicleIds = createPicker.getCheckedIds();

  if (!paiCode) errors.push('PAI Code is required.');
  if (!name) errors.push('Name is required.');

  if (!parentFile) {
    errors.push('Parent Assembly SVG is required.');
  } else {
    const expected = `pai_${paiCode}.svg`.toLowerCase();
    if (parentFile.name.toLowerCase() !== expected) {
      errors.push(`Parent SVG filename must be <strong>pai_${paiCode}.svg</strong> (got: ${parentFile.name}).`);
    }
  }

  if (thumbFiles.length && subFiles.length) {
    const subCodes = new Set(subFiles.map(f => f.name.replace(/\.svg$/i, '').toLowerCase()));
    for (const tf of thumbFiles) {
      const base = tf.name.replace(/\.(jpg|jpeg|png)$/i, '').toLowerCase();
      if (!base.startsWith('thumb_')) {
        errors.push(`Thumbnail <strong>${tf.name}</strong> must be named <code>thumb_{code}.jpg/png</code>.`);
        continue;
      }
      const code = base.slice(6);
      if (!subCodes.has(code)) {
        errors.push(`Thumbnail <strong>${tf.name}</strong>: no matching subassembly SVG found for code <em>${code}</em>.`);
      }
    }
  }

  return { errors, paiCode, name, parentFile, subFiles, thumbFiles, selectedVehicleIds };
}

$id('btnSubmit').addEventListener('click', () => {
  const v = validateCreate();
  if (v.errors.length) {
    showResult('Cannot Submit', `<ul>${v.errors.map(e => `<li>${e}</li>`).join('')}</ul>`, true);
    return;
  }

  const status = $id('fStatus').value;
  const willForceDraft = v.selectedVehicleIds.length === 0 && status === 'published';

  const proceed = (effectiveStatus) => {
    const confirmHtml = `
      Are you sure you want to submit the spare parts catalog
      <strong>${esc(v.name)}</strong> with parent code <strong>${esc(v.paiCode)}</strong>?
      <br><br>
      Vehicles to associate: <strong>${v.selectedVehicleIds.length}</strong>
      ${effectiveStatus !== status ? `<br>Status will be saved as <strong>${effectiveStatus}</strong>.` : ''}
    `;
    showConfirm(confirmHtml, () => doCreateSubmit({ ...v, status: effectiveStatus }));
  };

  if (willForceDraft) {
    showWarning(
      'No vehicles selected',
      `<p style="margin:0 0 8px;">You haven't selected any vehicles to associate with this catalog.</p>
       <p style="margin:0 0 8px;">Without at least one associated vehicle, the catalog cannot be published
       because no customer would be able to see it.</p>
       <p style="margin:0;">It will be saved as <strong>Draft</strong>. You can add vehicles and publish it later
       from the Update tab.</p>`,
      {
        okText: 'Save as Draft',
        cancelText: 'Cancel',
        onOk: () => proceed('draft'),
      }
    );
  } else {
    proceed(status);
  }
});

async function doCreateSubmit({ paiCode, name, parentFile, subFiles, thumbFiles, selectedVehicleIds, status }) {
  $id('btnSubmit').disabled = true;
  const uploadedPaths = [];

  try {
    const allSvgFiles = [parentFile, ...subFiles];
    const totalSteps = 3 + allSvgFiles.length + subFiles.length + thumbFiles.length + 1;
    let step = 0;
    const tick = (label, detail = '') => { step++; setProgress(Math.round(step / totalSteps * 100), label, detail); };

    tick('Uploading parent SVG…', parentFile.name);
    const parentPath = `${paiCode}/${parentFile.name}`;
    await uploadFile(parentPath, parentFile, 'image/svg+xml');
    uploadedPaths.push(parentPath);

    for (const f of subFiles) {
      tick('Uploading subassembly SVGs…', f.name);
      const p = `${paiCode}/svg/${f.name}`;
      await uploadFile(p, f, 'image/svg+xml');
      uploadedPaths.push(p);
    }

    for (const f of thumbFiles) {
      tick('Uploading thumbnails…', f.name);
      const p = `${paiCode}/thumb/${f.name}`;
      await uploadFile(p, f, mimeForFile(f.name));
      uploadedPaths.push(p);
    }

    tick('Building search index…', 'Parsing SVG BOM tables…');
    const index = await buildSearchIndex(paiCode, allSvgFiles);
    const indexBlob = new Blob([JSON.stringify(index)], { type: 'application/json' });
    const indexFile = new File([indexBlob], 'search-index.json');
    tick('Uploading search index…', `${index.rowsIndexed} BOM rows indexed`);
    const indexPath = `${paiCode}/search-index.json`;
    await uploadFile(indexPath, indexFile, 'application/json');
    uploadedPaths.push(indexPath);

    tick('Creating catalog record…');
    const description = $id('fDescription').value.trim() || null;
    const { data: rpcData, error: rpcErr } = await window.sb.rpc('create_catalog_with_vehicles', {
      p_pai_code: paiCode,
      p_name: name,
      p_description: description,
      p_status: status,
      p_kind: 'interactive',
      p_vehicle_ids: selectedVehicleIds,
    });

    if (rpcErr) throw new Error('Failed to create catalog: ' + rpcErr.message);

    setProgress(100, 'Done!', '');

    showResult(
      'Catalog Submitted Successfully',
      `<p>The catalog <strong>${esc(name)}</strong> (<code>${esc(paiCode)}</code>) has been submitted successfully.</p>
       <p>${allSvgFiles.length} SVG(s) uploaded · ${thumbFiles.length} thumbnail(s) · ${index.rowsIndexed} BOM rows indexed · ${rpcData.vehicle_count} vehicle(s) associated.</p>
       ${rpcData.effective_status !== status ? `<p>Status saved as <strong>${esc(rpcData.effective_status)}</strong>.</p>` : ''}`
    );

    setTimeout(() => {
      dirtyCreate.reset();
      hideProgress();
    }, 500);

  } catch (e) {
    console.error(e);
    for (const p of uploadedPaths) {
      try { await window.sb.storage.from(BUCKET).remove([p]); } catch { }
    }
    showResult('Submission Failed', `<p>${esc(e.message)}</p><p style="margin-top:8px;color:var(--gray2);font-size:12px;">Uploaded files were rolled back.</p>`, true);
    hideProgress();
  } finally {
    $id('btnSubmit').disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE TAB — catalog picker + edit form + submit
// ═══════════════════════════════════════════════════════════════════════════

let allCatalogs = [];
let uSortCol = 'name';
let uSortDir = 'asc';
let uFilters = { name: '', pai_code: '', status: '' };
let selectedCatalog = null;
let updateTabLoaded = false;

async function loadCatalogsForUpdate() {
  const tbody = $id('catPickerTbody');
  tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--gray);">Loading…</td></tr>`;

  const { data: cats, error } = await window.sb
    .from('catalogs')
    .select('id, name, pai_code, status, kind, created_at, updated_at, author, updated_by, description, change_log, revision')
    .in('status', ['published', 'draft', 'archived'])
    .order('name');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#b91c1c;padding:16px;">Failed to load catalogs: ${esc(error.message)}</td></tr>`;
    return;
  }

  const uuids = [...new Set([
    ...(cats || []).map(c => c.author).filter(Boolean),
    ...(cats || []).map(c => c.updated_by).filter(Boolean),
  ])];

  const nameMap = {};
  if (uuids.length) {
    const { data: profs } = await window.sb
      .from('profiles')
      .select('user_id, requested_full_name, role')
      .in('user_id', uuids);
    (profs || []).forEach(p => {
      nameMap[p.user_id] = p.requested_full_name || p.role || p.user_id.slice(0, 8);
    });
  }

  allCatalogs = (cats || []).map(c => ({
    ...c,
    _authorName: nameMap[c.author] || (c.author ? c.author.slice(0, 8) : '—'),
    _updatedByName: nameMap[c.updated_by] || (c.updated_by ? c.updated_by.slice(0, 8) : '—'),
  }));

  renderCatalogPicker();
}

function getCatalogsFiltered() {
  let rows = allCatalogs.filter(c =>
    c.name.toLowerCase().includes(uFilters.name) &&
    c.pai_code.toLowerCase().includes(uFilters.pai_code) &&
    (!uFilters.status || c.status === uFilters.status)
  );
  rows.sort((a, b) => {
    let va, vb;
    if (uSortCol === 'author') { va = a._authorName; vb = b._authorName; }
    else if (uSortCol === 'updated_by') { va = a._updatedByName; vb = b._updatedByName; }
    else { va = String(a[uSortCol] || ''); vb = String(b[uSortCol] || ''); }
    va = va.toLowerCase(); vb = vb.toLowerCase();
    return uSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
  });
  return rows;
}

function renderCatalogPicker() {
  const rows = getCatalogsFiltered();
  const tbody = $id('catPickerTbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--gray);padding:20px;">No catalogs found.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(c => `
    <tr class="catRow${selectedCatalog?.id === c.id ? ' selected' : ''}" data-id="${c.id}">
      <td style="font-weight:600">${esc(c.name)}</td>
      <td><code style="font-size:12px">${esc(c.pai_code)}</code></td>
      <td><span class="badge badge--${c.status}">${c.status}</span></td>
      <td style="white-space:nowrap">${fmtDt(c.created_at)}</td>
      <td>${esc(c._authorName)}</td>
      <td style="white-space:nowrap">${fmtDt(c.updated_at)}</td>
      <td>${esc(c._updatedByName)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.catRow').forEach(tr => {
    tr.addEventListener('click', () => {
      const cat = allCatalogs.find(c => c.id === tr.dataset.id);
      if (!cat) return;
      if (selectedCatalog && selectedCatalog.id !== cat.id) {
        guardNavigation(() => selectCatalogForEdit(cat));
      } else if (!selectedCatalog) {
        selectCatalogForEdit(cat);
      }
    });
  });
}

document.querySelectorAll('#catPickerTable th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (uSortCol === col) uSortDir = uSortDir === 'asc' ? 'desc' : 'asc';
    else { uSortCol = col; uSortDir = 'asc'; }
    document.querySelectorAll('#catPickerTable th[data-col]').forEach(t => {
      t.classList.remove('sorted');
      t.querySelector('.sortArrow').textContent = '↕';
    });
    th.classList.add('sorted');
    th.querySelector('.sortArrow').textContent = uSortDir === 'asc' ? '↑' : '↓';
    renderCatalogPicker();
  });
});

$id('uFilterName').addEventListener('input', e => { uFilters.name = e.target.value.toLowerCase(); renderCatalogPicker(); });
$id('uFilterCode').addEventListener('input', e => { uFilters.pai_code = e.target.value.toLowerCase(); renderCatalogPicker(); });
$id('uFilterStatus').addEventListener('change', e => { uFilters.status = e.target.value; renderCatalogPicker(); });

async function selectCatalogForEdit(cat) {
  selectedCatalog = cat;
  document.querySelectorAll('#catPickerTbody .catRow').forEach(tr => {
    tr.classList.toggle('selected', tr.dataset.id === cat.id);
  });

  // Delete button: only admins see it
  const delBtn = $id('btnDeleteCatalog');
  if (delBtn) {
    delBtn.style.display = (window.__userRole === 'admin') ? '' : 'none';
  }

  $id('uBannerName').textContent = cat.name;
  $id('uBannerMeta').textContent = `PAI ${cat.pai_code}  ·  ${cat.status}  ·  Last updated ${fmtDt(cat.updated_at)}`;
  $id('uPaiCode').value = cat.pai_code;
  $id('uName').value = cat.name;
  $id('uDescription').value = cat.description || '';
  $id('uKind').value = cat.kind;
  $id('uStatus').value = cat.status;
  $id('uChangeNote').value = '';
  $id('uParentSvg').value = '';
  $id('uSubSvgs').value = '';
  $id('uThumbs').value = '';

  renderChangeLog(cat.change_log || []);

  const { data: assoc, error } = await window.sb
    .from('vehicle_catalogs')
    .select('vehicle_id')
    .eq('catalog_id', cat.id);

  if (error) {
    showResult('Failed to load associations', `<p>${esc(error.message)}</p>`, true);
    return;
  }
  const associatedIds = (assoc || []).map(r => r.vehicle_id);

  try {
    await loadVehiclesOnce();
  } catch (e) {
    showResult('Failed to load vehicles', `<p>${esc(e.message)}</p>`, true);
    return;
  }
  updatePicker.setData(vehiclesCache, associatedIds);

  dirtyUpdate.snapshotFrom(cat);

  $id('updateEditArea').style.display = 'block';
  $id('updateEditArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderChangeLog(entries) {
  const wrap = $id('changeLogWrap');
  if (!entries.length) {
    wrap.innerHTML = '<div class="clEmpty">No changes recorded yet.</div>';
    return;
  }
  wrap.innerHTML = [...entries].reverse().map(e => `
    <div class="changeLogEntry">
      <span class="clTs">${fmtDt(e.ts)}</span>
      <span class="clUser">${esc(e.user_name || e.user_id?.slice(0, 8) || '?')}</span>
      ${e.fields?.length ? `<span class="clFields" style="grid-column:2">Changed: <strong>${esc(e.fields.join(', '))}</strong></span>` : ''}
      ${e.note ? `<span class="clNote" style="grid-column:2;white-space:pre-wrap">${esc(e.note)}</span>` : ''}
    </div>
  `).join('');
}

// ── Archive & Delete handlers ──────────────────────────────────────────────

$id('btnArchiveCatalog').addEventListener('click', () => {
  if (!selectedCatalog) return;

  // If there are unsaved changes, warn first.
  guardNavigation(() => {
    if (selectedCatalog.status === 'archived') {
      showResult('Already archived', `<p>This catalog is already archived.</p>`, true);
      return;
    }
    showWarning(
      'Archive catalog',
      `<p style="margin:0 0 8px;">Are you sure you want to archive catalog
        <strong>${esc(selectedCatalog.name)}</strong>
        (<code>${esc(selectedCatalog.pai_code)}</code>)?</p>
       <p style="margin:0 0 8px;">Archived catalogs are hidden from customers, client managers
       and internal users, but remain visible to admins and catalog managers.
       Storage files and vehicle associations are preserved.</p>
       <p style="margin:0;">This action is reversible — you can un-archive it later by
       editing the catalog and changing its status.</p>`,
      {
        okText: 'Archive',
        cancelText: 'Cancel',
        onOk: () => doArchiveCatalog(),
      }
    );
  });
});

async function doArchiveCatalog() {
  const btn = $id('btnArchiveCatalog');
  btn.disabled = true;

  try {
    const { data: { session } } = await window.sb.auth.getSession();
    const userId = session?.user?.id || null;
    let userName = userId ? userId.slice(0, 8) : 'unknown';
    if (userId) {
      const { data: prof } = await window.sb
        .from('profiles').select('requested_full_name, role')
        .eq('user_id', userId).maybeSingle();
      if (prof) userName = prof.requested_full_name || prof.role || userName;
    }

    const logEntry = {
      ts: new Date().toISOString(),
      user_id: userId,
      user_name: userName,
      fields: ['status'],
      note: `Catalog archived (was ${selectedCatalog.status}).`,
    };

    // Reuse the existing RPC, keeping name/description/vehicle set the same.
    const { data: assoc } = await window.sb
      .from('vehicle_catalogs')
      .select('vehicle_id')
      .eq('catalog_id', selectedCatalog.id);
    const currentVehicleIds = (assoc || []).map(r => r.vehicle_id);

    const { error: rpcErr } = await window.sb.rpc('update_catalog_and_vehicles', {
      p_catalog_id: selectedCatalog.id,
      p_name: selectedCatalog.name,
      p_description: selectedCatalog.description,
      p_status: 'archived',
      p_log_entry: logEntry,
      p_vehicle_ids: currentVehicleIds,
    });

    if (rpcErr) throw new Error(rpcErr.message);

    showResult(
      'Catalog archived',
      `<p>Catalog <strong>${esc(selectedCatalog.name)}</strong> has been archived.</p>
       <p>It is now hidden from customers, client managers and internal users.</p>`
    );

    // Refresh list and re-select to update the banner status.
    await loadCatalogsForUpdate();
    const refreshed = allCatalogs.find(c => c.id === selectedCatalog.id);
    if (refreshed) await selectCatalogForEdit(refreshed);
  } catch (e) {
    console.error(e);
    showResult('Failed to archive catalog', `<p>${esc(e.message)}</p>`, true);
  } finally {
    btn.disabled = false;
  }
}

$id('btnDeleteCatalog').addEventListener('click', () => {
  if (!selectedCatalog) return;
  // Bypass the dirty guard deliberately — deleting makes the dirty state moot.
  showDeleteWizardStep1();
});

function showDeleteWizardStep1() {
  const cat = selectedCatalog;
  showWarning(
    'Delete catalog permanently',
    `<p style="margin:0 0 10px;">You are about to <strong>permanently delete</strong> the catalog
      <strong>${esc(cat.name)}</strong> (<code>${esc(cat.pai_code)}</code>).</p>
     <p style="margin:0 0 10px;">This will <strong>irreversibly</strong>:</p>
     <ul style="margin:0 0 10px;padding-left:22px;">
       <li>Delete the catalog record and its entire change log</li>
       <li>Remove all vehicle associations for this catalog</li>
       <li>Delete every file in storage under <code>${esc(cat.pai_code)}/</code>
           (parent SVG, subassembly SVGs, thumbnails, search index)</li>
     </ul>
     <p style="margin:0 0 10px;">Vehicles, customers and user accounts are <strong>not</strong> affected —
       only the associations to this specific catalog.</p>
     <p style="margin:0;color:#b91c1c;font-weight:700;">This action cannot be undone.</p>`,
    {
      okText: 'I understand — continue',
      cancelText: 'Cancel',
      onOk: () => showDeleteWizardStep2(),
    }
  );
}

function showDeleteWizardStep2() {
  const cat = selectedCatalog;
  const bodyHtml = `
    <div class="deleteWizardBox">
      <div class="deleteWizardBody">
        <p style="margin:0 0 8px;">Catalog <strong>${esc(cat.name)}</strong>
          (<code>${esc(cat.pai_code)}</code>) will be permanently deleted.</p>
        <p style="margin:0;">Slide the handle all the way to the right to confirm.</p>
      </div>
      <div class="dragConfirm" id="dragConfirmEl">
        <div class="dragConfirmFill" id="dragConfirmFill"></div>
        <div class="dragConfirmTrack">
          <div class="dragConfirmLabel" id="dragConfirmLabel">Slide to delete <strong>${esc(cat.pai_code)}</strong></div>
        </div>
        <div class="dragConfirmHandle" id="dragConfirmHandle">→</div>
      </div>
    </div>
  `;
  // Use the confirm modal shell but DON'T set an onOk — the drag handle itself
  // is the trigger. The Cancel button cancels; the OK button is hidden.
  $id('confirmModalTitle').textContent = 'Final confirmation';
  $id('confirmModalBody').innerHTML = bodyHtml;
  $id('confirmModal').style.display = 'flex';

  const okBtn = $id('btnConfirmOk');
  const cancelBtn = $id('btnConfirmCancel');
  okBtn.style.display = 'none';
  cancelBtn.textContent = 'Cancel';

  const cleanup = () => {
    $id('confirmModal').style.display = 'none';
    okBtn.style.display = '';
    okBtn.textContent = 'Yes, submit';
    cancelBtn.textContent = 'Cancel';
    $id('confirmModalTitle').textContent = 'Confirm Catalog Submission';
    cancelBtn.onclick = null;
  };

  cancelBtn.onclick = cleanup;

  // Initialize the drag slider
  bindDragConfirm({
    onComplete: () => {
      cleanup();
      doDeleteCatalog();
    },
  });
}

// ── Drag-to-confirm slider implementation ─────────────────────────────────

function bindDragConfirm({ onComplete }) {
  const el = $id('dragConfirmEl');
  const handle = $id('dragConfirmHandle');
  const fill = $id('dragConfirmFill');
  const label = $id('dragConfirmLabel');
  if (!el || !handle) return;

  // Compute travel range (px). Handle is 44px wide with 3px margin.
  const HANDLE_W = 44, MARGIN = 3;
  const maxX = () => el.clientWidth - HANDLE_W - MARGIN * 2;

  let dragging = false;
  let startX = 0;
  let currentX = 0;

  const setX = (x) => {
    const max = maxX();
    const clamped = Math.max(0, Math.min(x, max));
    currentX = clamped;
    handle.style.transform = `translateX(${clamped}px)`;
    const pct = max > 0 ? clamped / max : 0;
    fill.style.width = `${(pct * 100).toFixed(2)}%`;
    if (label) label.style.opacity = String(1 - Math.min(pct * 1.6, 1));
  };

  const completeGesture = () => {
    const max = maxX();
    if (currentX >= max * 0.95) {
      // Success — snap to end, mark completed, fire callback.
      el.classList.add('completed', 'animating');
      setX(max);
      setTimeout(() => { onComplete?.(); }, 220);
    } else {
      // Snap back to start with animation.
      el.classList.add('animating');
      setX(0);
      setTimeout(() => { el.classList.remove('animating'); }, 260);
    }
  };

  const onDown = (clientX) => {
    dragging = true;
    startX = clientX - currentX;
    el.classList.remove('animating');
  };
  const onMove = (clientX) => {
    if (!dragging) return;
    setX(clientX - startX);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    completeGesture();
  };

  // Mouse events
  handle.addEventListener('mousedown', (e) => { e.preventDefault(); onDown(e.clientX); });
  window.addEventListener('mousemove', (e) => onMove(e.clientX));
  window.addEventListener('mouseup', onUp);

  // Touch events
  handle.addEventListener('touchstart', (e) => { if (e.touches[0]) onDown(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchmove', (e) => { if (e.touches[0]) onMove(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchend', onUp);
}

async function doDeleteCatalog() {
  const cat = selectedCatalog;
  if (!cat) return;

  try {
    // 1. Hard-delete via RPC
    const { data: rpcData, error: rpcErr } = await window.sb.rpc('delete_catalog', {
      p_catalog_id: cat.id,
      p_confirm_pai_code: cat.pai_code,
    });

    if (rpcErr) throw new Error(rpcErr.message);

    // 2. Best-effort cleanup of storage files under {pai_code}/
    const storageErrors = [];
    try {
      await removeStorageFolderRecursive(cat.pai_code);
    } catch (e) {
      storageErrors.push(e.message || String(e));
    }

    // 3. Success UI + reset state
    const storageMsg = storageErrors.length
      ? `<p style="margin-top:8px;color:#b45309;font-size:12px;">Some storage files could not be removed automatically. You may need to clean them up manually from the storage bucket. Details: ${esc(storageErrors.join('; '))}</p>`
      : `<p style="margin-top:8px;color:var(--gray2);font-size:12px;">All storage files removed.</p>`;

    showResult(
      'Catalog deleted',
      `<p>Catalog <strong>${esc(cat.name)}</strong> (<code>${esc(cat.pai_code)}</code>) has been permanently deleted.</p>
       <p>${rpcData.vehicles_removed} vehicle association(s) removed.</p>
       ${storageMsg}`
    );

    selectedCatalog = null;
    dirtyUpdate.clearSnapshot();
    $id('updateEditArea').style.display = 'none';
    await loadCatalogsForUpdate();
    $id('updatePickerCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    showResult('Failed to delete catalog', `<p>${esc(e.message)}</p>`, true);
  }
}

// Recursively remove every file under {prefix}/ in the storage bucket.
// Supabase Storage doesn't support recursive delete, so we list + remove.
async function removeStorageFolderRecursive(prefix) {
  const allPaths = [];
  async function walk(folder) {
    const { data, error } = await window.sb.storage.from(BUCKET).list(folder, { limit: 1000 });
    if (error) throw new Error(`Failed to list ${folder}: ${error.message}`);
    for (const item of (data || [])) {
      const full = folder ? `${folder}/${item.name}` : item.name;
      if (item.id === null) {
        // Sub-folder — recurse
        await walk(full);
      } else {
        allPaths.push(full);
      }
    }
  }
  await walk(prefix);
  if (!allPaths.length) return;

  // Remove in batches of 100
  for (let i = 0; i < allPaths.length; i += 100) {
    const batch = allPaths.slice(i, i + 100);
    const { error } = await window.sb.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`Failed to remove batch: ${error.message}`);
  }
}

$id('btnUpdateSubmit').addEventListener('click', async () => {
  if (!selectedCatalog) return;

  const name = $id('uName').value.trim();
  const note = $id('uChangeNote').value.trim();
  const status = $id('uStatus').value;
  const paiCode = selectedCatalog.pai_code;

  if (!name) { showResult('Validation Error', '<p>Name is required.</p>', true); return; }
  if (!note) { showResult('Validation Error', '<p>Change note is required.</p>', true); return; }

  const currentIds = updatePicker.getCheckedIds();
  const originalIds = updatePicker.getOriginalAssociatedIds();
  const origSet = new Set(originalIds);
  const currSet = new Set(currentIds);
  const addedIds = currentIds.filter(id => !origSet.has(id));
  const removedIds = originalIds.filter(id => !currSet.has(id));

  const parentFile = $id('uParentSvg').files[0] || null;
  const subFiles = Array.from($id('uSubSvgs').files);
  const thumbFiles = Array.from($id('uThumbs').files);

  const filesToProcess = [];
  if (parentFile) filesToProcess.push({ path: `${paiCode}/${parentFile.name}`, file: parentFile });
  subFiles.forEach(f => filesToProcess.push({ path: `${paiCode}/svg/${f.name}`, file: f }));
  thumbFiles.forEach(f => filesToProcess.push({ path: `${paiCode}/thumb/${f.name}`, file: f }));

  let toReplace = [];
  let toAdd = [];
  if (filesToProcess.length) {
    const foldersToCheck = new Set(filesToProcess.map(fp => {
      const parts = fp.path.split('/'); parts.pop(); return parts.join('/');
    }));
    const existingPaths = new Set();
    for (const folder of foldersToCheck) {
      const { data: listed } = await window.sb.storage.from(BUCKET).list(folder, { limit: 1000 });
      (listed || []).filter(item => item.id !== null).forEach(item => existingPaths.add(`${folder}/${item.name}`));
    }
    for (const fp of filesToProcess) {
      if (existingPaths.has(fp.path)) toReplace.push(fp);
      else toAdd.push(fp);
    }
  }

  const willForceDraft = currentIds.length === 0 && status === 'published';

  const fmtVehList = ids => ids.length
    ? `<ul style="margin:4px 0 0;padding-left:18px;font-size:12px;">${ids.map(id => `<li><code>${esc(pepCodeFor(id))}</code></li>`).join('')}</ul>`
    : `<p style="margin:4px 0 0;color:var(--gray2);font-size:12px;">none</p>`;
  const fmtFileList = arr => arr.length
    ? `<ul style="margin:4px 0 0;padding-left:18px;">${arr.map(fp => `<li><code>${esc(fp.file.name)}</code></li>`).join('')}</ul>`
    : `<p style="margin:4px 0 0;color:var(--gray2);font-size:13px;">none</p>`;

  const buildConfirmHtml = (effectiveStatus) => `
    <p>Are you sure you want to update catalog <strong>${esc(name)}</strong>?</p>
    ${effectiveStatus !== status ? `<p style="color:#b45309;"><strong>Status will be saved as ${esc(effectiveStatus)}</strong> (no vehicles associated).</p>` : ''}
    <p style="margin-top:14px;font-weight:700;font-size:13px;">Vehicles to add: ${addedIds.length}</p>
    ${fmtVehList(addedIds)}
    <p style="margin-top:10px;font-weight:700;font-size:13px;">Vehicles to remove: ${removedIds.length}</p>
    ${fmtVehList(removedIds)}
    <p style="margin-top:14px;font-weight:700;font-size:13px;">Files to be replaced:</p>
    ${fmtFileList(toReplace)}
    <p style="margin-top:10px;font-weight:700;font-size:13px;">Files to be added for the first time:</p>
    ${fmtFileList(toAdd)}
  `;

  const proceed = (effectiveStatus) => {
    showConfirm(
      buildConfirmHtml(effectiveStatus),
      () => doUpdateCatalog({
        toReplace, toAdd, name, note,
        status: effectiveStatus,
        currentVehicleIds: currentIds,
        addedIds, removedIds,
      }),
      { title: 'Confirm Catalog Update', okText: 'Save Changes' }
    );
  };

  if (willForceDraft) {
    showWarning(
      'No vehicles associated',
      `<p style="margin:0 0 8px;">You are saving this catalog with <strong>no vehicles associated</strong>.</p>
       <p style="margin:0 0 8px;">Without at least one associated vehicle, the catalog cannot be published
       because no customer would be able to see it.</p>
       <p style="margin:0;">It will be saved as <strong>Draft</strong>.</p>`,
      {
        okText: 'Save as Draft',
        cancelText: 'Cancel',
        onOk: () => proceed('draft'),
      }
    );
  } else {
    proceed(status);
  }
});

async function doUpdateCatalog({ toReplace, toAdd, name, note, status, currentVehicleIds, addedIds, removedIds }) {
  const btn = $id('btnUpdateSubmit');
  btn.disabled = true;
  const newlyUploadedPaths = [];

  try {
    const description = $id('uDescription').value.trim() || null;

    for (const fp of toReplace) {
      await uploadFile(fp.path, fp.file, mimeForFile(fp.file.name), true);
    }
    for (const fp of toAdd) {
      await uploadFile(fp.path, fp.file, mimeForFile(fp.file.name), false);
      newlyUploadedPaths.push(fp.path);
    }

    const changed = [];
    if (name !== selectedCatalog.name) changed.push('name');
    if (description !== (selectedCatalog.description || null)) changed.push('description');
    if (status !== selectedCatalog.status) changed.push('status');
    if (toReplace.length || toAdd.length) changed.push('files');
    if (addedIds.length || removedIds.length) changed.push('vehicles');

    const { data: { session } } = await window.sb.auth.getSession();
    const userId = session?.user?.id || null;
    let userName = userId ? userId.slice(0, 8) : 'unknown';
    if (userId) {
      const { data: prof } = await window.sb
        .from('profiles').select('requested_full_name, role')
        .eq('user_id', userId).maybeSingle();
      if (prof) userName = prof.requested_full_name || prof.role || userName;
    }

    const replacedNames = toReplace.length ? toReplace.map(fp => fp.file.name).join('\n') : 'none';
    const addedNames = toAdd.length ? toAdd.map(fp => fp.file.name).join('\n') : 'none';
    const addedPeps = addedIds.length ? addedIds.map(pepCodeFor).join(', ') : 'none';
    const removedPeps = removedIds.length ? removedIds.map(pepCodeFor).join(', ') : 'none';

    let fullNote = note;
    if (toReplace.length || toAdd.length) {
      fullNote += `\nReplaced files:\n${replacedNames}\nAdded new files:\n${addedNames}`;
    }
    if (addedIds.length || removedIds.length) {
      fullNote += `\nVehicles: +${addedIds.length} added, −${removedIds.length} removed`;
      if (addedIds.length) fullNote += `\nAdded: ${addedPeps}`;
      if (removedIds.length) fullNote += `\nRemoved: ${removedPeps}`;
    }

    const logEntry = {
      ts: new Date().toISOString(),
      user_id: userId,
      user_name: userName,
      fields: changed,
      note: fullNote,
    };

    const { data: rpcData, error: rpcErr } = await window.sb.rpc('update_catalog_and_vehicles', {
      p_catalog_id: selectedCatalog.id,
      p_name: name,
      p_description: description,
      p_status: status,
      p_log_entry: logEntry,
      p_vehicle_ids: currentVehicleIds,
    });

    if (rpcErr) throw new Error(rpcErr.message);

    $id('uParentSvg').value = '';
    $id('uSubSvgs').value = '';
    $id('uThumbs').value = '';

    showResult(
      'Catalog Updated',
      `<p>Catalog <strong>${esc(name)}</strong> saved successfully.</p>
       ${changed.length ? `<p>Fields changed: <strong>${esc(changed.join(', '))}</strong>.</p>` : '<p>No field values were changed.</p>'}
       ${toReplace.length ? `<p>${toReplace.length} file(s) replaced.</p>` : ''}
       ${toAdd.length ? `<p>${toAdd.length} file(s) added.</p>` : ''}
       ${addedIds.length ? `<p>${addedIds.length} vehicle(s) associated.</p>` : ''}
       ${removedIds.length ? `<p>${removedIds.length} vehicle(s) dis-associated.</p>` : ''}
       ${rpcData.effective_status !== status ? `<p>Status saved as <strong>${esc(rpcData.effective_status)}</strong>.</p>` : ''}`
    );

    await loadCatalogsForUpdate();
    const refreshed = allCatalogs.find(c => c.id === selectedCatalog.id);
    if (refreshed) {
      await selectCatalogForEdit(refreshed);
    }
  } catch (e) {
    console.error(e);
    for (const p of newlyUploadedPaths) {
      try { await window.sb.storage.from(BUCKET).remove([p]); } catch { }
    }
    showResult(
      'Update Failed',
      `<p>${esc(e.message)}</p>
       ${newlyUploadedPaths.length ? '<p style="margin-top:8px;color:var(--gray2);font-size:12px;">Newly-uploaded files were rolled back. Any files that replaced existing ones remain in storage.</p>' : ''}`,
      true
    );
  } finally {
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BEFORE UNLOAD — browser-level guard
// ═══════════════════════════════════════════════════════════════════════════

window.addEventListener('beforeunload', (e) => {
  const createActive = $id('tab-create')?.classList.contains('active');
  const tracker = createActive ? dirtyCreate : dirtyUpdate;
  if (tracker && tracker.isDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

createPicker.bindEvents();
updatePicker.bindEvents();

(async () => {
  try {
    const list = await loadVehiclesOnce();
    createPicker.setData(list, []);
  } catch (e) {
    $id('vehicleTbody').innerHTML = `<tr><td colspan="5" style="color:#b91c1c;padding:16px;">${esc(e.message)}</td></tr>`;
  }
})();
