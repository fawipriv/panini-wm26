// ── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initFamily();
  initTabs();
  initText();
  initFoto();
  initAudio();
  loadStats();
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

// ── Submit ───────────────────────────────────────────────────────────────────

async function submitSticker(payload) {
  showFeedback('Wird eingetragen…', 'loading');

  try {
    const res = await fetch(CONFIG.webhookUrl, {
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
      // Clear text input after success
      const input = document.getElementById('code-input');
      if (input) input.value = '';
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
    const res = await fetch(CONFIG.statsUrl, {
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
