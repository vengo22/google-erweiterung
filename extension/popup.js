(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const DEFAULTS = { format: 'h264', orientation: 'landscape', layout: '1', quality: 'best' };

  let clip = null;
  let settings = { ...DEFAULTS };
  let selected = null; // aktuell gewählte Qualität

  function show(section) {
    for (const id of ['empty', 'loading', 'error', 'clip']) $(id).classList.toggle('hidden', id !== section);
  }

  function showError(message) {
    $('error-text').textContent = message;
    show('error');
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(DEFAULTS);
      settings = { ...DEFAULTS, ...stored };
    } catch (e) { /* Standardwerte behalten */ }
  }

  function saveSettings() {
    try { chrome.storage.sync.set(settings); } catch (e) { /* egal */ }
  }

  function formatDuration(sec) {
    const s = Math.round(sec);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function setPressed(groupId, value) {
    for (const b of $(groupId).querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.value === value));
    }
  }

  // Hochformat wird im Editor aus dem Querformat zugeschnitten, daher immer die Querformat-Dateien
  function currentVariants() {
    return clip.orientations.landscape || clip.orientations.portrait;
  }

  function isPortrait() {
    return settings.orientation === 'portrait';
  }

  function pickDefaultVariant(variants) {
    if (settings.quality !== 'best') {
      const wanted = parseInt(settings.quality, 10);
      const match = variants.find((v) => parseInt(v.quality, 10) <= wanted);
      if (match) return match;
    }
    return variants[0];
  }

  function renderQualities() {
    const variants = currentVariants();
    if (!selected || !variants.includes(selected)) selected = pickDefaultVariant(variants);

    const box = $('qualities');
    box.textContent = '';
    for (const v of variants) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'quality';
      row.setAttribute('role', 'radio');
      row.setAttribute('aria-checked', String(v === selected));

      const dot = document.createElement('span');
      dot.className = 'dot';
      const res = document.createElement('span');
      res.className = 'res';
      res.textContent = v.quality + 'p';
      const fps = document.createElement('span');
      fps.className = 'fps';
      fps.textContent = v.fps ? v.fps + ' fps' : '';
      const badge = document.createElement('span');
      const premiereOk = v.codec === 'H.264';
      badge.className = 'badge ' + (premiereOk ? 'ok' : 'warn');
      badge.textContent = v.codec;
      badge.title = premiereOk ? 'Läuft in jedem Schnittprogramm' : 'Wird von vielen Schnittprogrammen nicht erkannt';

      row.append(dot, res, fps, badge);
      row.addEventListener('click', () => {
        selected = v;
        settings.quality = v === variants[0] ? 'best' : v.quality;
        saveSettings();
        renderQualities();
      });
      box.append(row);
    }
    renderHint();
  }

  function needsConversion() {
    return !isPortrait() && settings.format === 'h264' && selected && selected.codec !== 'H.264';
  }

  function renderHint() {
    const hint = $('hint');
    hint.className = 'note';
    if (isPortrait()) {
      hint.textContent = settings.layout === '2'
        ? 'Im nächsten Schritt ziehst du je einen Rahmen um die Webcam und ums Gameplay. Shorty setzt beides übereinander.'
        : 'Im nächsten Schritt wählst du aus, welcher Ausschnitt vom Gameplay ins Hochformat kommt.';
    } else if (needsConversion()) {
      hint.textContent = 'Twitch liefert diese Qualität als ' + selected.codec + '. Shorty wandelt sie nach dem Download automatisch in H.264 um – das dauert nur ein paar Sekunden.';
    } else if (settings.format === 'original' && selected && selected.codec !== 'H.264') {
      hint.classList.add('warn');
      hint.textContent = selected.codec + ' wird von vielen Schnittprogrammen nicht erkannt (nur Ton). Wähle oben „H.264“, wenn du den Clip schneiden willst.';
    } else {
      hint.classList.add('hidden');
    }
    renderSummary();
  }

  // Kurze Zeile unter dem Knopf: was gleich heruntergeladen wird
  function renderSummary() {
    const box = $('summary');
    box.textContent = '';
    if (!selected) return;
    const parts = [selected.quality + 'p' + (selected.fps ? ' ' + selected.fps + ' fps' : '')];
    if (isPortrait()) {
      parts.push('Hochformat', settings.layout === '2' ? 'Webcam + Gameplay' : 'nur Gameplay');
    } else {
      parts.push('Querformat');
      if (needsConversion()) parts.push('H.264 (aus ' + selected.codec + ')');
      else parts.push(selected.codec);
    }
    box.append(parts.join(' · '));
    if (!isPortrait() && settings.format === 'original' && selected.codec !== 'H.264') {
      const warn = document.createElement('span');
      warn.className = 'warn';
      warn.textContent = ' – oft nur Ton beim Schneiden';
      box.append(warn);
    }
  }

  // Was in den Einstellungen zu sehen ist, hängt von Quer-/Hochformat ab
  function renderMode() {
    setPressed('format', settings.format);
    setPressed('orientation', settings.orientation);
    setPressed('layout', settings.layout);
    $('format-wrap').classList.toggle('hidden', isPortrait());
    $('layout-wrap').classList.toggle('hidden', !isPortrait());
    $('download-label').textContent = isPortrait() ? 'Weiter zum Bearbeiten' : 'Herunterladen';
    $('cut-btn').classList.toggle('hidden', isPortrait()); // im Hochformat schneidet man im Editor sowieso
    renderHint();
  }

  function toggleSettings(open) {
    const btn = $('settings-toggle');
    const isOpen = open ?? btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(isOpen));
    $('settings').classList.toggle('hidden', !isOpen);
  }

  function renderClip() {
    $('thumb').src = clip.thumbnail || '';
    $('title').textContent = clip.title;
    $('meta').textContent = [clip.streamer, clip.duration ? formatDuration(clip.duration) : ''].filter(Boolean).join(' · ');

    $('filename').value = Twitch.suggestName(clip);

    renderQualities();
    renderMode();
    show('clip');
  }

  async function loadClip(slug) {
    show('loading');
    try {
      clip = await Twitch.getClip(slug);
      selected = null;
      renderClip();
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  // Editor in eigenem Tab öffnen (Hochformat oder Schneiden im Querformat)
  async function openEditor(filename, editMode) {
    const jobId = String(Date.now());
    await chrome.storage.session.set({ ['job_' + jobId]: {
      url: selected.url, filename, title: clip.title, streamer: clip.streamer,
      streamerLogin: clip.streamerLogin, thumbnail: clip.thumbnail, layout: settings.layout, mode: editMode,
    } });
    await chrome.tabs.create({ url: chrome.runtime.getURL('edit.html?job=' + jobId) });
    window.close();
  }

  async function startDownload(wantCut) {
    const base = Twitch.cleanName($('filename').value) || Twitch.suggestName(clip);
    const filename = base + '.mp4';
    const btn = $('download');
    btn.disabled = true;

    try {
      if (isPortrait() || wantCut === true) {
        await openEditor(filename, isPortrait() ? 'portrait' : 'landscape');
        return;
      }
      if (needsConversion()) {
        // Umwandlung in eigenem Tab, damit sie weiterläuft, wenn dieses Fenster zugeht.
        const jobId = String(Date.now());
        await chrome.storage.session.set({ ['job_' + jobId]: { url: selected.url, filename, title: clip.title, streamer: clip.streamer, thumbnail: clip.thumbnail } });
        await chrome.tabs.create({ url: chrome.runtime.getURL('convert.html?job=' + jobId) });
        window.close();
        return;
      }
      await chrome.downloads.download({ url: selected.url, filename, conflictAction: 'uniquify' });
      $('done').textContent = 'Download gestartet ✓';
      $('done').classList.remove('hidden');
    } catch (e) {
      showError('Download fehlgeschlagen: ' + (e.message || e));
    } finally {
      btn.disabled = false;
    }
  }

  function bind() {
    $('format').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      settings.format = b.dataset.value;
      saveSettings();
      renderMode();
    });
    $('orientation').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      settings.orientation = b.dataset.value;
      saveSettings();
      renderMode();
    });
    $('layout').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      settings.layout = b.dataset.value;
      saveSettings();
      renderMode();
    });
    $('filename').addEventListener('keydown', (e) => { if (e.key === 'Enter') startDownload(false); });
    $('download').addEventListener('click', () => startDownload(false));
    $('cut-btn').addEventListener('click', () => startDownload(true));
    $('settings-toggle').addEventListener('click', () => toggleSettings());
    $('link-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const slug = Twitch.slugFromUrl($('link').value);
      if (slug) loadClip(slug);
      else showError('Das ist kein Twitch-Clip-Link. Er sieht z. B. so aus: clips.twitch.tv/… oder twitch.tv/name/clip/…');
    });
    $('retry').addEventListener('click', () => {
      show('empty');
      $('link').focus();
    });
  }

  async function init() {
    bind();
    await loadSettings();
    let slug = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      slug = tab && Twitch.slugFromUrl(tab.url);
    } catch (e) { /* kein Zugriff auf den Tab */ }
    if (slug) loadClip(slug);
    else {
      show('empty');
      $('link').focus();
    }
  }

  init();
})();
