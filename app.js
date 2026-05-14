// ── Session ──────────────────────────────────────────────────────────────────

function getSession() {
  try { return JSON.parse(localStorage.getItem('panini_session')) || null; } catch { return null; }
}

function saveSession(data) {
  localStorage.setItem('panini_session', JSON.stringify(data));
}

function clearSession() {
  localStorage.removeItem('panini_session');
  localStorage.removeItem('panini_nutzer');
  sessionStorage.removeItem('panini_collection');
  location.reload();
}

function getSheetName() {
  return getSession()?.sheetName || '';
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const session = getSession();
  if (!session) {
    initLoginScreen();
  } else {
    startApp(session);
  }
});

function startApp(session) {
  document.getElementById('login-overlay').hidden = true;
  document.getElementById('family-name').textContent = session.displayName;
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (confirm(`Als ${session.displayName} abmelden?`)) clearSession();
  });

  initFamily(session.members);
  initTabs();
  initText();
  initFoto();
  initAudio();
  initNav();
  initSammlung();
  loadStats();
  initExport();
}

// ── Login ─────────────────────────────────────────────────────────────────────

function initLoginScreen() {
  const btn        = document.getElementById('login-btn');
  const familyInput = document.getElementById('login-family');
  const pinInput   = document.getElementById('login-pin');
  const errorEl    = document.getElementById('login-error');

  async function doLogin() {
    const familyName = familyInput.value.trim().toLowerCase();
    const pin        = pinInput.value.trim();
    if (!familyName || !pin) {
      showLoginError('Bitte Familie und PIN eingeben.');
      return;
    }
    btn.disabled    = true;
    btn.textContent = 'Anmelden…';
    errorEl.hidden  = true;

    try {
      const res = await fetchWithRetry(CONFIG.loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyName, pin })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) {
        showLoginError(data.message || 'Anmeldung fehlgeschlagen.');
      } else {
        saveSession({
          familyKey:   data.familyKey,
          displayName: data.displayName,
          members:     data.members,
          sheetName:   data.sheetName
        });
        startApp(getSession());
      }
    } catch {
      showLoginError('Verbindungsfehler. Bitte nochmal versuchen.');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Anmelden';
    }
  }

  function showLoginError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  btn.addEventListener('click', doLogin);
  pinInput.addEventListener('keydown',    e => { if (e.key === 'Enter') doLogin(); });
  familyInput.addEventListener('keydown', e => { if (e.key === 'Enter') pinInput.focus(); });
}

// ── Family dropdown ──────────────────────────────────────────────────────────

function initFamily(members) {
  const sel = document.getElementById('nutzer');
  sel.innerHTML = '';
  members.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  const saved = localStorage.getItem('panini_nutzer');
  if (saved && members.includes(saved)) sel.value = saved;
  sel.addEventListener('change', () => localStorage.setItem('panini_nutzer', sel.value));
}

function getNutzer() {
  return document.getElementById('nutzer').value || (getSession()?.members?.[0] || 'Unbekannt');
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
  const btn   = document.getElementById('btn-text');

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
  const preview   = document.getElementById('foto-preview');
  const placeholder = document.getElementById('foto-placeholder');
  const btnPick   = document.getElementById('btn-foto-pick');
  const btnSend   = document.getElementById('btn-foto-send');

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
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Audio input ──────────────────────────────────────────────────────────────

function initAudio() {
  const btn    = document.getElementById('btn-mic');
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
    } catch {
      showFeedback('Mikrofon-Zugriff verweigert. Bitte Berechtigung erteilen.', 'error');
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    btn.classList.remove('recording');
    btn.textContent = 'Halten zum Aufnehmen';
  }

  btn.addEventListener('mousedown',  startRecording);
  btn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); });
  btn.addEventListener('mouseup',    stopRecording);
  btn.addEventListener('mouseleave', stopRecording);
  btn.addEventListener('touchend',   stopRecording);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
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
      body: JSON.stringify({ ...payload, sheetName: getSheetName() })
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
  } catch {
    showFeedback('Verbindungsfehler. Bitte nochmal versuchen.', 'error');
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const res = await fetchWithRetry(CONFIG.statsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetName: getSheetName() })
    });
    if (!res.ok) return;
    const data = await res.json();
    updateStats(data.vorhanden || 0, data.doppelt || 0);
  } catch {
    updateStats(null, null);
  }
}

function updateStats(vorhanden, doppelt) {
  const v = vorhanden ?? '–';
  const f = vorhanden != null ? CONFIG.totalStickers - vorhanden : '–';
  const d = doppelt ?? '–';

  document.getElementById('stat-vorhanden').textContent = v;
  document.getElementById('stat-fehlt').textContent     = f;
  document.getElementById('stat-doppelt').textContent   = d;

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
  el.className   = type;
  el.hidden      = false;
}

function clearFeedback() {
  const el = document.getElementById('feedback');
  el.hidden    = true;
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

let collectionData  = null;
let _pendingScrollY = null;
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
      body: JSON.stringify({ sheetName: getSheetName() })
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

// key = CSV/API team name → { flag, de: German display name }
const TEAMS = {
  // Special
  'FIFA World Cup':        { flag: '🏆', de: 'FIFA World Cup' },
  'FIFA Museum':           { flag: '🏛️', de: 'FIFA Museum' },
  'FWC':                   { flag: '🏆', de: 'FIFA World Cup' },
  'World Cup':             { flag: '🏆', de: 'FIFA World Cup' },
  // CONCACAF
  'United States':         { flag: '🇺🇸', de: 'USA' },
  'USA':                   { flag: '🇺🇸', de: 'USA' },
  'Mexico':                { flag: '🇲🇽', de: 'Mexiko' },
  'Canada':                { flag: '🇨🇦', de: 'Kanada' },
  'Costa Rica':            { flag: '🇨🇷', de: 'Costa Rica' },
  'Honduras':              { flag: '🇭🇳', de: 'Honduras' },
  'Jamaica':               { flag: '🇯🇲', de: 'Jamaika' },
  'Panama':                { flag: '🇵🇦', de: 'Panama' },
  'El Salvador':           { flag: '🇸🇻', de: 'El Salvador' },
  'Guatemala':             { flag: '🇬🇹', de: 'Guatemala' },
  'Haiti':                 { flag: '🇭🇹', de: 'Haiti' },
  'Curaçao':               { flag: '🇨🇼', de: 'Curaçao' },
  'Trinidad and Tobago':   { flag: '🇹🇹', de: 'Trinidad und Tobago' },
  'Cuba':                  { flag: '🇨🇺', de: 'Kuba' },
  // CONMEBOL
  'Argentina':             { flag: '🇦🇷', de: 'Argentinien' },
  'Brazil':                { flag: '🇧🇷', de: 'Brasilien' },
  'Uruguay':               { flag: '🇺🇾', de: 'Uruguay' },
  'Colombia':              { flag: '🇨🇴', de: 'Kolumbien' },
  'Ecuador':               { flag: '🇪🇨', de: 'Ecuador' },
  'Venezuela':             { flag: '🇻🇪', de: 'Venezuela' },
  'Chile':                 { flag: '🇨🇱', de: 'Chile' },
  'Paraguay':              { flag: '🇵🇾', de: 'Paraguay' },
  'Bolivia':               { flag: '🇧🇴', de: 'Bolivien' },
  'Peru':                  { flag: '🇵🇪', de: 'Peru' },
  // UEFA
  'Germany':               { flag: '🇩🇪', de: 'Deutschland' },
  'France':                { flag: '🇫🇷', de: 'Frankreich' },
  'Spain':                 { flag: '🇪🇸', de: 'Spanien' },
  'Portugal':              { flag: '🇵🇹', de: 'Portugal' },
  'England':               { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', de: 'England' },
  'Netherlands':           { flag: '🇳🇱', de: 'Niederlande' },
  'Belgium':               { flag: '🇧🇪', de: 'Belgien' },
  'Switzerland':           { flag: '🇨🇭', de: 'Schweiz' },
  'Croatia':               { flag: '🇭🇷', de: 'Kroatien' },
  'Denmark':               { flag: '🇩🇰', de: 'Dänemark' },
  'Austria':               { flag: '🇦🇹', de: 'Österreich' },
  'Scotland':              { flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', de: 'Schottland' },
  'Serbia':                { flag: '🇷🇸', de: 'Serbien' },
  'Turkey':                { flag: '🇹🇷', de: 'Türkei' },
  'Türkiye':               { flag: '🇹🇷', de: 'Türkei' },
  'Poland':                { flag: '🇵🇱', de: 'Polen' },
  'Italy':                 { flag: '🇮🇹', de: 'Italien' },
  'Hungary':               { flag: '🇭🇺', de: 'Ungarn' },
  'Slovakia':              { flag: '🇸🇰', de: 'Slowakei' },
  'Slovenia':              { flag: '🇸🇮', de: 'Slowenien' },
  'Czech Republic':        { flag: '🇨🇿', de: 'Tschechien' },
  'Czechia':               { flag: '🇨🇿', de: 'Tschechien' },
  'Romania':               { flag: '🇷🇴', de: 'Rumänien' },
  'Wales':                 { flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', de: 'Wales' },
  'Albania':               { flag: '🇦🇱', de: 'Albanien' },
  'Ukraine':               { flag: '🇺🇦', de: 'Ukraine' },
  'Greece':                { flag: '🇬🇷', de: 'Griechenland' },
  'Norway':                { flag: '🇳🇴', de: 'Norwegen' },
  'Iceland':               { flag: '🇮🇸', de: 'Island' },
  'Northern Ireland':      { flag: '🏴', de: 'Nordirland' },
  'Georgia':               { flag: '🇬🇪', de: 'Georgien' },
  'Kosovo':                { flag: '🇽🇰', de: 'Kosovo' },
  'Sweden':                { flag: '🇸🇪', de: 'Schweden' },
  'Finland':               { flag: '🇫🇮', de: 'Finnland' },
  'Bosnia and Herzegovina':{ flag: '🇧🇦', de: 'Bosnien-Herzegowina' },
  'North Macedonia':       { flag: '🇲🇰', de: 'Nordmazedonien' },
  'Montenegro':            { flag: '🇲🇪', de: 'Montenegro' },
  'Luxembourg':            { flag: '🇱🇺', de: 'Luxemburg' },
  'Belarus':               { flag: '🇧🇾', de: 'Belarus' },
  'Russia':                { flag: '🇷🇺', de: 'Russland' },
  // CAF
  'Morocco':               { flag: '🇲🇦', de: 'Marokko' },
  'Senegal':               { flag: '🇸🇳', de: 'Senegal' },
  'Nigeria':               { flag: '🇳🇬', de: 'Nigeria' },
  'Egypt':                 { flag: '🇪🇬', de: 'Ägypten' },
  'Ivory Coast':           { flag: '🇨🇮', de: 'Elfenbeinküste' },
  "Côte d'Ivoire":         { flag: '🇨🇮', de: 'Elfenbeinküste' },
  'Cameroon':              { flag: '🇨🇲', de: 'Kamerun' },
  'Ghana':                 { flag: '🇬🇭', de: 'Ghana' },
  'Mali':                  { flag: '🇲🇱', de: 'Mali' },
  'DR Congo':              { flag: '🇨🇩', de: 'DR Kongo' },
  'Congo DR':              { flag: '🇨🇩', de: 'DR Kongo' },
  'South Africa':          { flag: '🇿🇦', de: 'Südafrika' },
  'Tanzania':              { flag: '🇹🇿', de: 'Tansania' },
  'Algeria':               { flag: '🇩🇿', de: 'Algerien' },
  'Tunisia':               { flag: '🇹🇳', de: 'Tunesien' },
  'Zimbabwe':              { flag: '🇿🇼', de: 'Simbabwe' },
  'Cape Verde':            { flag: '🇨🇻', de: 'Kap Verde' },
  'Guinea':                { flag: '🇬🇳', de: 'Guinea' },
  'Zambia':                { flag: '🇿🇲', de: 'Sambia' },
  'Uganda':                { flag: '🇺🇬', de: 'Uganda' },
  'Mozambique':            { flag: '🇲🇿', de: 'Mosambik' },
  'Comoros':               { flag: '🇰🇲', de: 'Komoren' },
  // AFC
  'Japan':                 { flag: '🇯🇵', de: 'Japan' },
  'South Korea':           { flag: '🇰🇷', de: 'Südkorea' },
  'Korea Republic':        { flag: '🇰🇷', de: 'Südkorea' },
  'Australia':             { flag: '🇦🇺', de: 'Australien' },
  'Saudi Arabia':          { flag: '🇸🇦', de: 'Saudi-Arabien' },
  'Iran':                  { flag: '🇮🇷', de: 'Iran' },
  'Iraq':                  { flag: '🇮🇶', de: 'Irak' },
  'Qatar':                 { flag: '🇶🇦', de: 'Katar' },
  'Uzbekistan':            { flag: '🇺🇿', de: 'Usbekistan' },
  'China':                 { flag: '🇨🇳', de: 'China' },
  'Indonesia':             { flag: '🇮🇩', de: 'Indonesien' },
  'Jordan':                { flag: '🇯🇴', de: 'Jordanien' },
  'Oman':                  { flag: '🇴🇲', de: 'Oman' },
  'United Arab Emirates':  { flag: '🇦🇪', de: 'Vereinigte Arabische Emirate' },
  'UAE':                   { flag: '🇦🇪', de: 'Vereinigte Arabische Emirate' },
  'Thailand':              { flag: '🇹🇭', de: 'Thailand' },
  'Vietnam':               { flag: '🇻🇳', de: 'Vietnam' },
  'India':                 { flag: '🇮🇳', de: 'Indien' },
  'Kyrgyzstan':            { flag: '🇰🇬', de: 'Kirgisistan' },
  'Bahrain':               { flag: '🇧🇭', de: 'Bahrain' },
  'Kuwait':                { flag: '🇰🇼', de: 'Kuwait' },
  // OFC
  'New Zealand':           { flag: '🇳🇿', de: 'Neuseeland' },
};

function teamInfo(name) {
  return TEAMS[name] || { flag: '', de: name };
}

function renderCollection() {
  if (!collectionData) return;
  const list = document.getElementById('collection-list');

  let stickers = collectionData.filter(s => {
    if (collectionFilter === 'vorhanden' && s.status !== 'vorhanden' && s.status !== 'doppelt') return false;
    if (collectionFilter === 'doppelt'   && s.status !== 'doppelt')   return false;
    if (collectionFilter === 'fehlt'     && s.status !== 'fehlt')     return false;
    if (collectionSearch) {
      const q      = collectionSearch;
      const deTeam = teamInfo(s.team).de.toLowerCase();
      if (!s.code.toLowerCase().includes(q) &&
          !s.name.toLowerCase().includes(q) &&
          !s.team.toLowerCase().includes(q) &&
          !deTeam.includes(q)) return false;
    }
    return true;
  });

  if (stickers.length === 0) {
    list.innerHTML = '<div class="collection-empty"><span>Keine Sticker gefunden.</span></div>';
    return;
  }

  // Preserve album order: teams and stickers within teams keep CSV row order
  const teamOrder = [];
  const grouped   = {};
  stickers.forEach(s => {
    if (!grouped[s.team]) { grouped[s.team] = []; teamOrder.push(s.team); }
    grouped[s.team].push(s);
  });

  const teamTotals = {};
  collectionData.forEach(s => {
    if (!teamTotals[s.team]) teamTotals[s.team] = { total: 0, collected: 0 };
    teamTotals[s.team].total++;
    if (s.status !== 'fehlt') teamTotals[s.team].collected++;
  });

  let html = '';
  teamOrder.forEach(team => {
    const items = grouped[team];
    const t     = teamTotals[team] || { total: items.length, collected: 0 };
    html += `
      <div class="team-group">
        <div class="team-header">
          <span class="team-name">${teamInfo(team).flag} ${escHtml(teamInfo(team).de)}</span>
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

  if (_pendingScrollY !== null) {
    const y = _pendingScrollY;
    _pendingScrollY = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }
}

function renderStickerRow(s) {
  const foil      = s.foil === true || s.foil === 'TRUE' || s.foil === 'true';
  const foilBadge = foil ? '<span class="foil-star" title="Glitzer-Sticker">✦</span>' : '';
  let badge = '';
  if (s.status === 'doppelt')        badge = `<span class="badge badge-doppelt">×${s.doppelt + 1}</span>`;
  else if (s.status === 'vorhanden') badge = `<span class="badge badge-vorhanden">✓</span>`;
  else                               badge = `<span class="badge badge-fehlt">–</span>`;

  const safeName  = escHtml(s.name).replace(/'/g, '&#39;');
  const addBtn    = `<button class="sticker-add-btn" onclick="confirmAddSticker('${escHtml(s.code)}','${safeName}','${escHtml(s.status)}')" aria-label="${escHtml(s.code)} eintragen">+</button>`;
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
  document.getElementById('confirm-sub').textContent   = sub;
  okBtn.textContent = okLabel;
  okBtn.className   = okClass;
  sheet.hidden      = false;
  okBtn.onclick     = async () => { sheet.hidden = true; await onOk(); };
  document.getElementById('confirm-cancel').onclick  = () => { sheet.hidden = true; };
  document.getElementById('confirm-backdrop').onclick = () => { sheet.hidden = true; };
}

function confirmAddSticker(code, name, status) {
  const isDupe = status === 'vorhanden' || status === 'doppelt';
  showConfirmSheet({
    title:   `${name} (${code})`,
    sub:     isDupe ? `Bereits vorhanden — als Doppelgänger eintragen?` : `Als ${getNutzer()} eintragen?`,
    okLabel: 'Eintragen ✓',
    okClass: 'btn-primary',
    onOk:    () => addStickerFromSammlung(code)
  });
}

function confirmRemoveSticker(code, name, status) {
  const sub = status === 'doppelt'
    ? `Einen Doppelgänger von ${name} entfernen?`
    : `${name} als nicht vorhanden markieren?`;
  showConfirmSheet({
    title:   `${name} (${code})`,
    sub,
    okLabel: 'Entfernen ✗',
    okClass: 'btn-danger',
    onOk:    () => removeStickerFromSammlung(code)
  });
}

async function removeStickerFromSammlung(code) {
  showToast('Wird entfernt…', 'warning');
  try {
    const res = await fetchWithRetry(CONFIG.removeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, nutzer: getNutzer(), sheetName: getSheetName() })
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      sessionStorage.removeItem('panini_collection');
      collectionData  = null;
      _pendingScrollY = window.scrollY;
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
      body: JSON.stringify({ inputType: 'text', code, nutzer: getNutzer(), sheetName: getSheetName() })
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.success) {
      showToast(data.message, data.isDuplicate ? 'warning' : 'success');
      sessionStorage.removeItem('panini_collection');
      collectionData  = null;
      _pendingScrollY = window.scrollY;
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
  toast.className   = type;
  toast.hidden      = false;
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

function groupByTeam(stickers) {
  const teamOrder = [];
  const grouped   = {};
  stickers.forEach(s => {
    if (!grouped[s.team]) { grouped[s.team] = []; teamOrder.push(s.team); }
    grouped[s.team].push(s);
  });
  return { teamOrder, grouped };
}

function renderExportTexts() {
  if (!collectionData) return;

  const missingBox  = document.getElementById('export-missing-box');
  const dupesBox    = document.getElementById('export-dupes-box');
  const copyMissing = document.getElementById('btn-copy-missing');
  const copyDupes   = document.getElementById('btn-copy-dupes');

  // ── Fehlende ──
  const missingStickers = collectionData.filter(s => s.status === 'fehlt' && s.code);
  if (missingStickers.length === 0) {
    missingBox.textContent = 'Du hast keine fehlenden Sticker mehr! 🎉';
    copyMissing.disabled   = true;
  } else {
    const { teamOrder, grouped } = groupByTeam(missingStickers);
    const lines = ['Mir fehlen noch:'];
    teamOrder.forEach(team => {
      const { flag, de } = teamInfo(team);
      const codes = grouped[team].map(s => s.code).join(', ');
      lines.push(`${flag} ${de}: ${codes}`);
    });
    const text = lines.join('\n');
    missingBox.textContent = text;
    copyMissing.disabled   = false;
    copyMissing._text      = text;
  }

  // ── Doppelte ──
  const dupeStickers = collectionData.filter(s => s.status === 'doppelt' && s.code);
  if (dupeStickers.length === 0) {
    dupesBox.textContent = 'Du hast keine Doppelten.';
    copyDupes.disabled   = true;
  } else {
    const { teamOrder, grouped } = groupByTeam(dupeStickers);
    const lines = ['Ich habe doppelt:'];
    teamOrder.forEach(team => {
      const { flag, de } = teamInfo(team);
      const codes = grouped[team].map(s => {
        const extras = parseInt(s.doppelt) || 1;
        return extras > 1 ? `${s.code} (×${extras})` : s.code;
      }).join(', ');
      lines.push(`${flag} ${de}: ${codes}`);
    });
    const text = lines.join('\n');
    dupesBox.textContent = text;
    copyDupes.disabled   = false;
    copyDupes._text      = text;
  }
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Kopiert ✓';
    showToast('Text kopiert!', 'success');
    setTimeout(() => { btn.textContent = 'Kopieren'; }, 2000);
  }).catch(() => {
    showToast('Kopieren fehlgeschlagen.', 'error');
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}
