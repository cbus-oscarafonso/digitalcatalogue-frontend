// catalog-manager.js

const STORAGE_BASE = "https://ytwwcrhtcsdpqeualnsx.supabase.co/storage/v1/object/public/catalogs";
const BUCKET = "catalogs";

// ── Helpers ────────────────────────────────────────────────────────────────

function $id(id) { return document.getElementById(id); }

function normPartNo(s) {
  return String(s || '').replace(/[\s\-_]/g, '').toUpperCase();
}

function normDesc(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Tabs ───────────────────────────────────────────────────────────────────

document.querySelectorAll('.tabBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabBtn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tabPanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Modals ─────────────────────────────────────────────────────────────────

function showConfirm(html, onOk) {
  $id('confirmModalBody').innerHTML = html;
  $id('confirmModal').style.display = 'flex';
  const ok = $id('btnConfirmOk');
  const cancel = $id('btnConfirmCancel');
  const cleanup = () => { $id('confirmModal').style.display = 'none'; ok.onclick = null; cancel.onclick = null; };
  ok.onclick = () => { cleanup(); onOk(); };
  cancel.onclick = cleanup;
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

// ── Vehicles ───────────────────────────────────────────────────────────────

let allVehicles = [];
let sortCol = 'pep_code';
let sortDir = 'asc';
let filters = { pep_code: '', cobus_bus_no: '', customer: '', vin: '' };

async function loadVehicles() {
  const { data, error } = await window.sb
    .from('vehicles')
    .select('id, pep_code, cobus_bus_no, vin, customer:customers(name)')
    .order('pep_code');

  if (error) {
    $id('vehicleTbody').innerHTML = `<tr><td colspan="5" style="color:#b91c1c;padding:16px;">Failed to load vehicles.</td></tr>`;
    return;
  }

  allVehicles = (data || []).map(v => ({
    id: v.id,
    pep_code: v.pep_code || '',
    cobus_bus_no: v.cobus_bus_no || '',
    customer: v.customer?.name || '',
    vin: v.vin || '',
    checked: false,
  }));

  renderVehicles();
}

function getFilteredSorted() {
  let rows = allVehicles.filter(v =>
    v.pep_code.toLowerCase().includes(filters.pep_code) &&
    v.cobus_bus_no.toLowerCase().includes(filters.cobus_bus_no) &&
    v.customer.toLowerCase().includes(filters.customer) &&
    v.vin.toLowerCase().includes(filters.vin)
  );

  rows.sort((a, b) => {
    const va = a[sortCol].toLowerCase();
    const vb = b[sortCol].toLowerCase();
    return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  return rows;
}

function renderVehicles() {
  const rows = getFilteredSorted();
  const tbody = $id('vehicleTbody');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--gray);padding:20px;">No vehicles found.</td></tr>`;
    updateSelectedCount();
    return;
  }

  tbody.innerHTML = rows.map(v => `
    <tr>
      <td><input type="checkbox" data-id="${v.id}" ${v.checked ? 'checked' : ''}></td>
      <td>${esc(v.pep_code)}</td>
      <td>${esc(v.cobus_bus_no)}</td>
      <td>${esc(v.customer)}</td>
      <td>${esc(v.vin)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const v = allVehicles.find(x => x.id === chk.dataset.id);
      if (v) v.checked = chk.checked;
      updateSelectedCount();
      syncSelectAll();
    });
  });

  updateSelectedCount();
  syncSelectAll();
}

function updateSelectedCount() {
  const n = allVehicles.filter(v => v.checked).length;
  $id('selectedCount').textContent = n ? `${n} selected` : '';
}

function syncSelectAll() {
  const visible = getFilteredSorted();
  const allChecked = visible.length > 0 && visible.every(v => v.checked);
  $id('chkSelectAll').checked = allChecked;
  $id('chkSelectAll').indeterminate = !allChecked && visible.some(v => v.checked);
}

$id('chkSelectAll').addEventListener('change', (e) => {
  const visible = getFilteredSorted();
  visible.forEach(v => v.checked = e.target.checked);
  renderVehicles();
});

['filterPep', 'filterBusNo', 'filterCustomer', 'filterVin'].forEach((id, i) => {
  const keys = ['pep_code', 'cobus_bus_no', 'customer', 'vin'];
  $id(id).addEventListener('input', (e) => {
    filters[keys[i]] = e.target.value.toLowerCase();
    renderVehicles();
  });
});

document.querySelectorAll('.vehicleTable th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortCol = col; sortDir = 'asc'; }

    document.querySelectorAll('.vehicleTable th[data-col]').forEach(t => {
      t.classList.remove('sorted');
      t.querySelector('.sortArrow').textContent = '↕';
    });
    th.classList.add('sorted');
    th.querySelector('.sortArrow').textContent = sortDir === 'asc' ? '↑' : '↓';
    renderVehicles();
  });
});

function esc(s) {
  return String(s || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

// ── SVG Text extraction (mirrors Python extract_svg_text_nodes) ────────────

function extractSvgTextNodes(svgDoc) {
  const nodes = [];
  svgDoc.querySelectorAll('text').forEach(el => {
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt) nodes.push(txt);
  });
  return nodes;
}

// ── BOM parsing (mirrors Python parse_bom_tokens) ──────────────────────────

function parseBomTokens(nodes) {
  const low = x => (x || '').toLowerCase();
  const isPos  = x => x === 'Pos.' || low(x) === 'pos.' || low(x) === 'pos';
  const isQty  = x => x === 'Qty.' || low(x) === 'qty.' || low(x) === 'qty';
  const isDesc = x => low(x) === 'description';
  const isPartNo = x => low(x) === 'part no';
  const isPart = x => low(x) === 'part';
  const isNo   = x => low(x) === 'no';

  const headers = [];
  for (let i = 0; i < nodes.length; i++) {
    const [a, b, c, d, e] = [nodes[i], nodes[i+1], nodes[i+2], nodes[i+3], nodes[i+4]];
    if (isPos(a) && isPartNo(b) && isQty(c) && isDesc(d))          { headers.push({idx:i, headerLen:4}); continue; }
    if (isPos(a) && isPart(b) && isNo(c) && isQty(d) && isDesc(e)) { headers.push({idx:i, headerLen:5}); continue; }
  }

  if (!headers.length) return [];

  const rowsByPos = new Map();

  for (const h of headers) {
    const tail = nodes.slice(h.idx + h.headerLen);
    let start = -1;

    for (let i = 0; i < tail.length - 3; i++) {
      const [pos, partNo, qty, desc] = [tail[i], tail[i+1], tail[i+2], tail[i+3]];
      if (/^\d+$/.test(pos) && /^\d+$/.test(qty) && partNo && desc) { start = i; break; }
      if (i > 0 && isPos(pos)) break;
    }

    if (start < 0) continue;

    let i = start;
    while (i < tail.length - 3) {
      const [pos, partRaw, qty, desc] = [tail[i], tail[i+1], tail[i+2], tail[i+3]];
      if (!/^\d+$/.test(pos) || !/^\d+$/.test(qty) || !partRaw || !desc) break;

      const partNo = partRaw.replace(/\s+/g, '');
      if (!rowsByPos.has(pos)) rowsByPos.set(pos, { pos, partNo, qty, desc });

      i += 4;
      if (i < tail.length && !/^\d+$/.test(tail[i])) break;
    }
  }

  return Array.from(rowsByPos.values()).sort((a, b) => Number(a.pos) - Number(b.pos));
}

// ── Search index builder (mirrors Python main()) ───────────────────────────

async function buildSearchIndex(paiCode, allSvgFiles) {
  const parser = new DOMParser();
  const entries = [];
  const allCodes = new Set();
  const rootCodes = new Set();

  // Parse all SVGs
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
        svgBase,
        code: codeKey,
        pos: r.pos,
        partNo: r.partNo,
        desc: r.desc,
        qty: r.qty,
        partNoN: normPartNo(r.partNo),
        descN: normDesc(r.desc),
      });
    }
  }

  // codeDesc: first description per normalized partNo
  const codeDesc = {};
  for (const e of entries) {
    const k = e.partNoN;
    const d = (e.desc || '').trim();
    if (k && d && !codeDesc[k]) codeDesc[k] = d;
  }

  for (const rc of rootCodes) {
    if (!codeDesc[rc]) codeDesc[rc] = 'Root assembly';
  }

  const missingCodeDesc = [...allCodes].filter(c => !codeDesc[c]).sort();

  // parentsOf graph
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
  for (const rc of rootCodes) {
    if (!parentsOf[rc]) parentsOf[rc] = new Set();
  }
  const parentsOfJson = Object.fromEntries(
    Object.entries(parentsOf).map(([k, v]) => [k, [...v].sort()])
  );

  // pathsToRoot (recursive with cache)
  const MAX_PATHS = 500, MAX_DEPTH = 50;
  const cache = new Map();

  function pathsToNode(codeKey) {
    if (cache.has(codeKey)) return cache.get(codeKey);
    cache.set(codeKey, []); // prevent cycles

    if (rootCodes.has(codeKey)) {
      cache.set(codeKey, [[codeKey]]);
      return [[codeKey]];
    }

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
  for (const c of [...svgCodes].sort()) {
    pathsToRoot[c] = pathsToNode(c);
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    svgsIndexed: allSvgFiles.length,
    svgsWithBom: new Set(entries.map(e => e.svgBase)).size,
    rowsIndexed: entries.length,
    entries,
    codeDesc,
    missingCodeDesc,
    parentsOf: parentsOfJson,
    pathsToRoot,
  };
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate() {
  const errors = [];

  const paiCode = $id('fPaiCode').value.trim();
  const name    = $id('fName').value.trim();
  const parentFile = $id('fParentSvg').files[0];
  const subFiles   = Array.from($id('fSubSvgs').files);
  const thumbFiles = Array.from($id('fThumbs').files);
  const selectedVehicles = allVehicles.filter(v => v.checked);

  if (!paiCode) errors.push('PAI Code is required.');
  if (!name)    errors.push('Name is required.');

  if (!parentFile) {
    errors.push('Parent Assembly SVG is required.');
  } else {
    const expected = `pai_${paiCode}.svg`.toLowerCase();
    if (parentFile.name.toLowerCase() !== expected) {
      errors.push(`Parent SVG filename must be <strong>pai_${paiCode}.svg</strong> (got: ${parentFile.name}).`);
    }
  }

  // Validate thumbnail names against subassembly codes
  if (thumbFiles.length && subFiles.length) {
    const subCodes = new Set(subFiles.map(f => f.name.replace(/\.svg$/i, '').toLowerCase()));
    for (const tf of thumbFiles) {
      const base = tf.name.replace(/\.(jpg|jpeg|png)$/i, '').toLowerCase();
      if (!base.startsWith('thumb_')) {
        errors.push(`Thumbnail <strong>${tf.name}</strong> must be named <code>thumb_{code}.jpg/png</code>.`);
        continue;
      }
      const code = base.slice(6); // remove "thumb_"
      if (!subCodes.has(code)) {
        errors.push(`Thumbnail <strong>${tf.name}</strong>: no matching subassembly SVG found for code <em>${code}</em>.`);
      }
    }
  }

  if (!selectedVehicles.length) errors.push('At least one vehicle must be selected.');

  return { errors, paiCode, name, parentFile, subFiles, thumbFiles, selectedVehicles };
}

// ── Upload ─────────────────────────────────────────────────────────────────

async function uploadFile(path, file, contentType) {
  const { error } = await window.sb.storage
    .from(BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (error) throw new Error(`Upload failed for ${path}: ${error.message}`);
}

// ── Submit ─────────────────────────────────────────────────────────────────

$id('btnSubmit').addEventListener('click', () => {
  const { errors, paiCode, name, parentFile, subFiles, thumbFiles, selectedVehicles } = validate();

  if (errors.length) {
    showResult('Cannot Submit', `<ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>`, true);
    return;
  }

  showConfirm(
    `Are you sure you want to submit the spare parts catalog <strong>${name}</strong> with parent code <strong>${paiCode}</strong>?`,
    () => doSubmit({ paiCode, name, parentFile, subFiles, thumbFiles, selectedVehicles })
  );
});

async function doSubmit({ paiCode, name, parentFile, subFiles, thumbFiles, selectedVehicles }) {
  $id('btnSubmit').disabled = true;

  try {
    const allSvgFiles = [parentFile, ...subFiles];
    const totalSteps = 3 + allSvgFiles.length + subFiles.length + thumbFiles.length + 1;
    let step = 0;

    const tick = (label, detail = '') => {
      step++;
      setProgress(Math.round(step / totalSteps * 100), label, detail);
    };

    // 1. Upload parent SVG
    tick('Uploading parent SVG…', parentFile.name);
    await uploadFile(`${paiCode}/${parentFile.name}`, parentFile, 'image/svg+xml');

    // 2. Upload subassembly SVGs
    for (const f of subFiles) {
      tick('Uploading subassembly SVGs…', f.name);
      await uploadFile(`${paiCode}/svg/${f.name}`, f, 'image/svg+xml');
    }

    // 3. Upload thumbnails
    for (const f of thumbFiles) {
      tick('Uploading thumbnails…', f.name);
      const mime = f.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      await uploadFile(`${paiCode}/thumb/${f.name}`, f, mime);
    }

    // 4. Build and upload search index
    tick('Building search index…', 'Parsing SVG BOM tables…');
    const index = await buildSearchIndex(paiCode, allSvgFiles);
    const indexBlob = new Blob([JSON.stringify(index)], { type: 'application/json' });
    const indexFile = new File([indexBlob], 'search-index.json');
    tick('Uploading search index…', `${index.rowsIndexed} BOM rows indexed`);
    await uploadFile(`${paiCode}/search-index.json`, indexFile, 'application/json');

    // 5. Insert catalog record
    tick('Creating catalog record…');
    const status = $id('fStatus').value;
    const description = $id('fDescription').value.trim() || null;
    const { data: { session: _sess } } = await window.sb.auth.getSession();
    const _authorId = _sess?.user?.id || null;

    const { data: catalog, error: catErr } = await window.sb
      .from('catalogs')
      .insert({ pai_code: paiCode, name, description, kind: 'interactive', status, author: _authorId })
      .select('id')
      .single();

    if (catErr) throw new Error('Failed to create catalog record: ' + catErr.message);

    // 6. Associate vehicles
    tick('Associating vehicles…');
    const vcInserts = selectedVehicles.map(v => ({
      vehicle_id: v.id,
      catalog_id: catalog.id,
    }));

    const { error: vcErr } = await window.sb
      .from('vehicle_catalogs')
      .insert(vcInserts);

    if (vcErr) throw new Error('Failed to associate vehicles: ' + vcErr.message);

    setProgress(100, 'Done!', '');

    showResult(
      'Catalog Submitted Successfully',
      `<p>The catalog <strong>${name}</strong> (<code>${paiCode}</code>) has been submitted successfully.</p>
       <p>${allSvgFiles.length} SVG(s) uploaded · ${thumbFiles.length} thumbnail(s) · ${index.rowsIndexed} BOM rows indexed · ${selectedVehicles.length} vehicle(s) associated.</p>`
    );

    // Reset form
    setTimeout(() => {
      $id('fPaiCode').value = '';
      $id('fName').value = '';
      $id('fDescription').value = '';
      $id('fParentSvg').value = '';
      $id('fSubSvgs').value = '';
      $id('fThumbs').value = '';
      allVehicles.forEach(v => v.checked = false);
      renderVehicles();
      hideProgress();
    }, 500);

  } catch (e) {
    console.error(e);
    showResult('Submission Failed', `<p>${e.message}</p>`, true);
  } finally {
    $id('btnSubmit').disabled = false;
  }
}

// ── Init ───────────────────────────────────────────────────────────────────

loadVehicles();

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE TAB
// ═══════════════════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────────────────

let allCatalogs     = [];
let uSortCol        = 'name';
let uSortDir        = 'asc';
let uFilters        = { name: '', pai_code: '', status: '' };
let selectedCatalog = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Load catalogs ──────────────────────────────────────────────────────────

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

  // Resolve display names for all unique user UUIDs in one query
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
    _authorName:    nameMap[c.author]     || (c.author     ? c.author.slice(0, 8)     : '—'),
    _updatedByName: nameMap[c.updated_by] || (c.updated_by ? c.updated_by.slice(0, 8) : '—'),
  }));

  renderCatalogPicker();
}

// ── Filter + sort ──────────────────────────────────────────────────────────

function getCatalogsFiltered() {
  let rows = allCatalogs.filter(c =>
    c.name.toLowerCase().includes(uFilters.name) &&
    c.pai_code.toLowerCase().includes(uFilters.pai_code) &&
    (!uFilters.status || c.status === uFilters.status)
  );

  rows.sort((a, b) => {
    let va, vb;
    if (uSortCol === 'author')     { va = a._authorName;    vb = b._authorName;    }
    else if (uSortCol === 'updated_by') { va = a._updatedByName; vb = b._updatedByName; }
    else { va = String(a[uSortCol] || ''); vb = String(b[uSortCol] || ''); }
    va = va.toLowerCase(); vb = vb.toLowerCase();
    return uSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  return rows;
}

// ── Render picker table ────────────────────────────────────────────────────

function renderCatalogPicker() {
  const rows  = getCatalogsFiltered();
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
      if (cat) selectCatalogForEdit(cat);
    });
  });
}

// ── Sort headers ───────────────────────────────────────────────────────────

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

// ── Filters ────────────────────────────────────────────────────────────────

$id('uFilterName').addEventListener('input',    e => { uFilters.name     = e.target.value.toLowerCase(); renderCatalogPicker(); });
$id('uFilterCode').addEventListener('input',    e => { uFilters.pai_code = e.target.value.toLowerCase(); renderCatalogPicker(); });
$id('uFilterStatus').addEventListener('change', e => { uFilters.status   = e.target.value;               renderCatalogPicker(); });

// ── Select catalog for editing ─────────────────────────────────────────────

function selectCatalogForEdit(cat) {
  selectedCatalog = cat;

  document.querySelectorAll('#catPickerTbody .catRow').forEach(tr => {
    tr.classList.toggle('selected', tr.dataset.id === cat.id);
  });

  $id('uBannerName').textContent = cat.name;
  $id('uBannerMeta').textContent =
    `PAI ${cat.pai_code}  ·  ${cat.status}  ·  Last updated ${fmtDt(cat.updated_at)}`;

  $id('uPaiCode').value     = cat.pai_code;
  $id('uName').value        = cat.name;
  $id('uDescription').value = cat.description || '';
  $id('uKind').value        = cat.kind;
  $id('uStatus').value      = cat.status;
  $id('uChangeNote').value  = '';

  renderChangeLog(cat.change_log || []);

  $id('updateEditArea').style.display = 'block';
  $id('updateEditArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Change log renderer ────────────────────────────────────────────────────

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
      ${e.note ? `<span class="clNote" style="grid-column:2">${esc(e.note)}</span>` : ''}
    </div>
  `).join('');
}

// ── Clear selection ────────────────────────────────────────────────────────

$id('btnClearCatSel').addEventListener('click', () => {
  selectedCatalog = null;
  $id('updateEditArea').style.display = 'none';
  document.querySelectorAll('#catPickerTbody .catRow').forEach(tr => tr.classList.remove('selected'));
  $id('updatePickerCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ── Submit update ──────────────────────────────────────────────────────────

$id('btnUpdateSubmit').addEventListener('click', () => {
  if (!selectedCatalog) return;
  const name = $id('uName').value.trim();
  if (!name) { showResult('Validation Error', '<p>Name is required.</p>', true); return; }

  showConfirm(
    `Save changes to catalog <strong>${esc(name)}</strong> (PAI: <strong>${esc(selectedCatalog.pai_code)}</strong>)?`,
    doUpdateCatalog
  );
});

async function doUpdateCatalog() {
  const btn = $id('btnUpdateSubmit');
  btn.disabled = true;

  try {
    const name        = $id('uName').value.trim();
    const description = $id('uDescription').value.trim() || null;
    const status      = $id('uStatus').value;
    const note        = $id('uChangeNote').value.trim() || null;

    const changed = [];
    if (name        !== selectedCatalog.name)                        changed.push('name');
    if (description !== (selectedCatalog.description || null))       changed.push('description');
    if (status      !== selectedCatalog.status)                      changed.push('status');

    const { data: { session } } = await window.sb.auth.getSession();
    const userId = session?.user?.id || null;

    let userName = userId ? userId.slice(0, 8) : 'unknown';
    if (userId) {
      const { data: prof } = await window.sb
        .from('profiles')
        .select('requested_full_name, role')
        .eq('user_id', userId)
        .maybeSingle();
      if (prof) userName = prof.requested_full_name || prof.role || userName;
    }

    const logEntry = {
      ts:        new Date().toISOString(),
      user_id:   userId,
      user_name: userName,
      fields:    changed,
      ...(note ? { note } : {}),
    };

    const newChangeLog = [...(selectedCatalog.change_log || []), logEntry];

    const { error } = await window.sb
      .from('catalogs')
      .update({
        name,
        description,
        status,
        revision:   (selectedCatalog.revision || 0) + 1,
        updated_by: userId,
        change_log: newChangeLog,
      })
      .eq('id', selectedCatalog.id);

    if (error) throw new Error(error.message);

    showResult(
      'Catalog Updated',
      `<p>Catalog <strong>${esc(name)}</strong> saved successfully.</p>
       ${changed.length
         ? `<p>Fields changed: <strong>${esc(changed.join(', '))}</strong>.</p>`
         : '<p>No field values were changed.</p>'}`
    );

    await loadCatalogsForUpdate();
    const refreshed = allCatalogs.find(c => c.id === selectedCatalog.id);
    if (refreshed) selectCatalogForEdit(refreshed);

  } catch (e) {
    console.error(e);
    showResult('Update Failed', `<p>${esc(e.message)}</p>`, true);
  } finally {
    btn.disabled = false;
  }
}

// ── Lazy-load on first tab click ───────────────────────────────────────────

let updateTabLoaded = false;

document.querySelectorAll('.tabBtn').forEach(btn => {
  if (btn.dataset.tab === 'update') {
    btn.addEventListener('click', () => {
      if (!updateTabLoaded) {
        updateTabLoaded = true;
        loadCatalogsForUpdate();
      }
    });
  }
});
