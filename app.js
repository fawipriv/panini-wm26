// ── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initFamily();
  initTabs();
  initText();
  initFoto();
  initAudio();
  initNav();
  initSammlung();
  loadStats();
  initExport();
});

// ── Family dropdown ──────────────────────────────────────────────────────────

function initFamily() {
  const sel = document.getElementById('nutzer');
  CONFIG.family.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  const saved = localStorage.getItem('panini_nutzer');
  if (saved && CONFIG.family.includes(saved)) sel.value = saved;
  sel.addEventListener('change', () => localStorage.setItem('panini_nutzer', sel.value));
}

function getNutzer() {
  return document.getElementById('nutzer').value || CONFIG.family[0];
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      clearFeedback();
    });
  });
}

// ── Text input ───────────────────────────────────────────────────────────────

function initText() {
  const input = document.getElementById('code-input');
  const btn = document.getElementById('btn-text');

  btn.addEventListener('click', () => {
    const code = input.value.trim().toUpperCase();
    if (!code) return showFeedback('Bitte einen Sticker-Code eingeben.', 'error');
    submitSticker({ inputType: 'text', code, nutzer: getNutzer() });
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') btn.click();
  });
}

// ── Foto input ───────────────────────────────────────────────────────────────

function initFoto() {
  const fileInput = document.getElementById('foto-input');
  const preview = document.getElementById('foto-preview');
  const placeholder = document.getElementById('foto-placeholder');
  const btnPick = document.getElementById('btn-foto-pick');
  const btnSend = document.getElementById('btn-foto-send');

  btnPick.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.hidden = false;
    placeholder.hidden = true;
    btnSend.disabled = false;
  });

  btnSend.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    showFeedback('Foto wird analysiert…', 'loading');
    btnSend.disabled = true;

    const fotoData = await fileToBase64(file);
    await submitSticker({ inputType: 'foto', fotoData, nutzer: getNutzer() });

    btnSend.disabled = false;
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Audio input ──────────────────────────────────────────────────────────────

function initAudio() {
  const btn = document.getElementById('btn-mic');
  const status = document.getElementById('audio-status');
  let mediaRecorder = null;
  let chunks = [];

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const audioData = await blobToBase64(blob);
        status.textContent = 'Wird verarbeitet…';
        showFeedback('Sprachaufnahme wird ausgewertet…', 'loading');
        await submitSticker({ inputType: 'audio', audioData, nutzer: getNutzer() });
        status.textContent = 'Halte die Taste gedrückt und sprich den Sticker-Code';
      };
      mediaRecorder.start();
      btn.classList.add('recording');
      btn.textContent = 'Aufnahme läuft… loslassen zum Senden';
      status.textContent = 'Aufnahme läuft…';
    } catch (err) {
      showFeedback('Mikrofon-Zugriff verweigert. Bitte Berechtigung erteilen.', 'error');
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    btn.classList.remove('recording');
    btn.textContent = 'Halten zum Aufnehmen';
  }

  btn.addEventListener('mousedown', startRecording);
  btn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); });
  btn.addEventListener('mouseup', stopRecording);
  btn.addEventListener('mouseleave', stopRecording);
  btn.addEventListener('touchend', stopRecording);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Fetch with retry ─────────────────────────────────────────────────────────

async function fetchWithRetry(url, options, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1500));
      } else {
        throw err;
      }
    }
  }
}

// ── Submit ───────────────────────────────────────────────────────────────────

async function submitSticker(payload) {
  showFeedback('Wird eingetragen…', 'loading');

  try {
    const res = await fetchWithRetry(CONFIG.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (!data.success) {
      showFeedback(data.message || 'Fehler beim Eintragen.', 'error');
      return;
    }

    if (data.isDuplicate) {
      showFeedback(data.message, 'warning');
    } else {
      showFeedback(data.message, 'success');
      const input = document.getElementById('code-input');
      if (input) input.value = '';
      sessionStorage.removeItem('panini_collection');
    }

    loadStats();
  } catch (err) {
    showFeedback('Verbindungsfehler. Bitte nochmal versuchen.', 'error');
    console.error(err);
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const res = await fetchWithRetry(CONFIG.statsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!res.ok) return;
    const data = await res.json();
    updateStats(data.vorhanden || 0, data.doppelt || 0);
  } catch {
    // Stats endpoint not yet set up — use placeholder
    updateStats(null, null);
  }
}

function updateStats(vorhanden, doppelt) {
  const v = vorhanden ?? '–';
  const f = vorhanden != null ? CONFIG.totalStickers - vorhanden : '–';
  const d = doppelt ?? '–';

  document.getElementById('stat-vorhanden').textContent = v;
  document.getElementById('stat-fehlt').textContent = f;
  document.getElementById('stat-doppelt').textContent = d;

  if (vorhanden != null) {
    const pct = Math.round((vorhanden / CONFIG.totalStickers) * 100);
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-text').textContent = `${vorhanden} / ${CONFIG.totalStickers} (${pct}%)`;
  } else {
    document.getElementById('progress-text').textContent = `– / ${CONFIG.totalStickers}`;
  }
}

// ── Feedback ─────────────────────────────────────────────────────────────────

function showFeedback(msg, type) {
  const el = document.getElementById('feedback');
  el.textContent = msg;
  el.className = type;
  el.hidden = false;
}

function clearFeedback() {
  const el = document.getElementById('feedback');
  el.hidden = true;
  el.className = '';
}

// ── Bottom Nav ────────────────────────────────────────────────────────────────

function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      document.getElementById('eintragen-section').hidden = section !== 'eintragen';
      document.getElementById('sammlung-section').hidden  = section !== 'sammlung';
      document.getElementById('export-section').hidden    = section !== 'export';
      if ((section === 'sammlung' || section === 'export') && !collectionData) {
        loadCollection();
      } else if (section === 'export') {
        renderExportTexts();
      }
    });
  });
}

// ── Sammlung ──────────────────────────────────────────────────────────────────

let collectionData = null;
let collectionFilter = 'alle';
let collectionSearch = '';

function initSammlung() {
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      collectionFilter = chip.dataset.filter;
      renderCollection();
    });
  });

  const searchInput = document.getElementById('collection-search');
  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      collectionSearch = searchInput.value.trim().toLowerCase();
      renderCollection();
    }, 180);
  });
}

async function loadCollection() {
  const list = document.getElementById('collection-list');

  const cached = sessionStorage.getItem('panini_collection');
  if (cached) {
    try {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < 5 * 60 * 1000) {
        collectionData = data;
        renderCollection();
        renderExportTexts();
        return;
      }
    } catch {}
  }

  list.innerHTML = '<div class="collection-loading"><div class="spinner"></div>Sammlung wird geladen…</div>';

  try {
    const res = await fetchWithRetry(CONFIG.collectionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    collectionData = Array.isArray(data) ? data : (data.stickers || []);
    sessionStorage.setItem('panini_collection', JSON.stringify({ data: collectionData, ts: Date.now() }));
    renderCollection();
    renderExportTexts();
  } catch {
    list.innerHTML = '<div class="collection-error"><span>Sammlung konnte nicht geladen werden.</span><button class="retry-btn" onclick="loadCollection()">Nochmals versuchen</button></div>';
  }
}

function renderCollection() {
  if (!collectionData) return;
  const list = document.getElementById('collection-list');

  let stickers = collectionData.filter(s => {
    if (collectionFilter === 'vorhanden' && s.status !== 'vorhanden' && s.status !== 'doppelt') return false;
    if (collectionFilter === 'doppelt' && s.status !== 'doppelt') return false;
    if (collectionFilter === 'fehlt' && s.status !== 'fehlt') return false;
    if (collectionSearch) {
      const q = collectionSearch;
      if (!s.code.toLowerCase().includes(q) &&
          !s.name.toLowerCase().includes(q) &&
          !s.team.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (stickers.length === 0) {
    list.innerHTML = '<div class="collection-empty"><span>Keine Sticker gefunden.</span></div>';
    return;
  }

  const grouped = {};
  stickers.forEach(s => {
    if (!grouped[s.team]) grouped[s.team] = [];
    grouped[s.team].push(s);
  });

  Object.values(grouped).forEach(arr => {
    arr.sort((a, b) => {
      const na = parseInt(a.code.replace(/[^0-9]/g, '')) || 0;
      const nb = parseInt(b.code.replace(/[^0-9]/g, '')) || 0;
      return na - nb;
    });
  });

  const teamTotals = {};
  collectionData.forEach(s => {
    if (!teamTotals[s.team]) teamTotals[s.team] = { total: 0, collected: 0 };
    teamTotals[s.team].total++;
    if (s.status !== 'fehlt') teamTotals[s.team].collected++;
  });

  const teamOrder = Object.keys(grouped).sort((a, b) => {
    const ca = teamTotals[a] ? teamTotals[a].collected : 0;
    const cb = teamTotals[b] ? teamTotals[b].collected : 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b);
  });

  let html = '';
  teamOrder.forEach(team => {
    const items = grouped[team];
    const t = teamTotals[team] || { total: items.length, collected: 0 };
    html += `
      <div class="team-group">
        <div class="team-header">
          <span class="team-name">${escHtml(team)}</span>
          <div class="team-meta">
            <span class="team-progress">${t.collected} / ${t.total}</span>
          </div>
        </div>
        <div class="sticker-list">
          ${items.map(renderStickerRow).join('')}
        </div>
      </div>`;
  });

  list.innerHTML = html;
}

function renderStickerRow(s) {
  const foil = s.foil === true || s.foil === 'TRUE' || s.foil === 'true';
  const foilBadge = foil ? '<span class="foil-star" title="Glitzer-Sticker">✦</span>' : '';
  let badge = '';
  if (s.status === 'doppelt')        badge = `<span class="badge badge-doppelt">×${s.doppelt + 1}</span>`;
  else if (s.status === 'vorhanden') badge = `<span class="badge badge-vorhanden">✓</span>`;
  else                               badge = `<span class="badge badge-fehlt">–</span>`;

  const safeName = escHtml(s.name).replace(/'/g, '&#39;');
  const addBtn = `<button class="sticker-add-btn" onclick="confirmAddSticker('${escHtml(s.code)}','${safeName}','${escHtml(s.status)}')" aria-label="${escHtml(s.code)} eintragen">+</button>`;
  const removeBtn = s.status !== 'fehlt'
    ? `<button class="sticker-remove-btn" onclick="confirmRemoveSticker('${escHtml(s.code)}','${safeName}','${escHtml(s.status)}')" aria-label="${escHtml(s.code)} entfernen">−</button>`
    : '';

  return `
    <div class="sticker-row ${escHtml(s.status)}">
      <span class="sticker-code">${escHtml(s.code)}</span>
      <span class="sticker-name">${escHtml(s.name)}${foilBadge}</span>
      ${badge}
      <div class="sticker-actions">${removeBtn}${addBtn}</div>
    </div>`;
}

// ── Confirm Sheet ─────────────────────────────────────────────────────────────

function showConfirmSheet({ title, sub, okLabel, okClass, onOk }) {
  const sheet = document.getElementById('confirm-sheet');
  const okBtn = document.getElementById('confirm-ok');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-sub').textContent = sub;
  okBtn.textContent = okLabel;
  okBtn.className = okClass;
  sheet.hidden = false;
  okBtn.onclick = async () => { sheet.hidden = true; await onOk(); };
  document.getElementById('confirm-cancel').onclick = () => { sheet.hidden = true; };
  document.getElementById('confirm-backdrop').onclick = () => { sheet.hidden = true; };
}

function confirmAddSticker(code, name, status) {
  const isDupe = status === 'vorhanden' || status === 'doppelt';
  showConfirmSheet({
    title: `${name} (${code})`,
    sub: isDupe ? `Bereits vorhanden — als Doppelgänger eintragen?` : `Als ${getNutzer()} eintragen?`,
    okLabel: 'Eintragen ✓',
    okClass: 'btn-primary',
    onOk: () => addStickerFromSammlung(code)
  });
}

function confirmRemoveSticker(code, name, status) {
  const sub = status === 'doppelt'
    ? `Einen Doppelgänger von ${name} entfernen?`
    : `${name} als nicht vorhanden markieren?`;
  showConfirmSheet({
    title: `${name} (${code})`,
    sub,
    okLabel: 'Entfernen ✗',
    okClass: 'btn-danger',
    onOk: () => removeStickerFromSammlung(code)
  });
}

async function removeStickerFromSammlung(code) {
  showToast('Wird entfernt…', 'warning');
  try {
    const res = await fetchWithRetry(CONFIG.removeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, nutzer: getNutzer() })
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      sessionStorage.removeItem('panini_collection');
      collectionData = null;
      loadStats();
      loadCollection();
    } else {
      showToast(data.message || 'Fehler beim Entfernen.', 'error');
    }
  } catch {
    showToast('Verbindungsfehler.', 'error');
  }
}

async function addStickerFromSammlung(code) {
  showToast('Wird eingetragen…', 'success');
  try {
    const res = await fetchWithRetry(CONFIG.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputType: 'text', code, nutzer: getNutzer() })
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.success) {
      showToast(data.message, data.isDuplicate ? 'warning' : 'success');
      sessionStorage.removeItem('panini_collection');
      collectionData = null;
      loadStats();
      loadCollection();
    } else {
      showToast(data.message || 'Fehler beim Eintragen.', 'error');
    }
  } catch {
    showToast('Verbindungsfehler.', 'error');
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = type;
  toast.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.hidden = true; }, 3000);
}

// ── Export ────────────────────────────────────────────────────────────────────

function initExport() {
  document.getElementById('btn-copy-missing').addEventListener('click', function () {
    copyToClipboard(this._text, this);
  });
  document.getElementById('btn-copy-dupes').addEventListener('click', function () {
    copyToClipboard(this._text, this);
  });
}

function renderExportTexts() {
  if (!collectionData) return;

  const missingBox  = document.getElementById('export-missing-box');
  const dupesBox    = document.getElementById('export-dupes-box');
  const copyMissing = document.getElementById('btn-copy-missing');
  const copyDupes   = document.getElementById('btn-copy-dupes');

  const missing = collectionData
    .filter(s => s.status === 'fehlt')
    .map(s => s.code)
    .sort();

  if (missing.length === 0) {
    missingBox.textContent = 'Du hast keine fehlenden Sticker mehr! 🎉';
    copyMissing.disabled = true;
  } else {
    const text = `Mir fehlen noch: ${missing.join(', ')}.`;
    missingBox.textContent = text;
    copyMissing.disabled = false;
    copyMissing._text = text;
  }

  const dupes = collectionData
    .filter(s => s.status === 'doppelt')
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(s => {
      const extras = parseInt(s.doppelt) || 1;
      return extras > 1 ? `${s.code} (×${extras})` : s.code;
    });

  if (dupes.length === 0) {
    dupesBox.textContent = 'Du hast keine Doppelten.';
    copyDupes.disabled = true;
  } else {
    const text = `Ich habe doppelt: ${dupes.join(', ')}.`;
    dupesBox.textContent = text;
    copyDupes.disabled = false;
    copyDupes._text = text;
  }
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Kopiert ✓';
    showToast('Text kopiert!', 'success');
    setTimeout(() => { btn.textContent = 'Kopieren'; }, 2000);
  }).catch(() => {
    showToast('Kopieren fehlgeschlagen.', 'error');
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
