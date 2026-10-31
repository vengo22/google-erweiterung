// Editor: Clip schneiden (Quer- und Hochformat) und im Hochformat Gameplay/Webcam zuschneiden.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MIN_SIZE = 60; // kleinster Rahmen in Original-Pixeln

  let job = null;
  let buffer = null;
  let src = { w: 1920, h: 1080 }; // Größe des Originals
  let out = { w: 1080, h: 1920 }; // Größe des fertigen Videos
  let layout = '1';
  let camPos = 'top'; // Webcam im fertigen Video oben oder unten
  let mode = 'portrait'; // oder 'landscape'
  let timeline = null;
  const rects = { game: null, cam: null }; // in Original-Pixeln

  // ---------- Hilfen ----------

  function setStatus(text, kind) {
    const s = $('status');
    s.className = 'note' + (kind ? ' ' + kind : '');
    s.textContent = text;
  }

  function setBar(name, fraction, doneText) {
    $('bar-' + name).style.width = Math.round(fraction * 100) + '%';
    $('pct-' + name).textContent = doneText || Math.round(fraction * 100) + ' %';
  }

  function formatTime(sec) {
    const s = Math.floor(sec || 0);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function cleanName(name) {
    return (name || '').replace(/\.mp4$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Die Webcam darf im fertigen Video 20–60 % der Höhe einnehmen
  const CAM_MIN = 0.2;
  const CAM_MAX = 0.6;
  function camAspectLimits() {
    return { min: out.w / (out.h * CAM_MAX), max: out.w / (out.h * CAM_MIN) };
  }

  // Bereiche im fertigen Video (in Ausgabe-Pixeln). Die Webcam bekommt die volle Breite,
  // ihre Höhe ergibt sich aus der Form ihres Rahmens – das Gameplay füllt den Rest.
  function targets() {
    if (layout === '1' || !rects.cam) return { game: { x: 0, y: 0, w: out.w, h: out.h } };
    const camH = Math.round(out.w / (rects.cam.w / rects.cam.h) / 2) * 2;
    const gameH = out.h - camH;
    if (camPos === 'bottom') {
      return {
        game: { x: 0, y: 0, w: out.w, h: gameH },
        cam: { x: 0, y: gameH, w: out.w, h: camH },
      };
    }
    return {
      cam: { x: 0, y: 0, w: out.w, h: camH },
      game: { x: 0, y: camH, w: out.w, h: gameH },
    };
  }

  function clampRect(r, aspect) {
    let w = Math.max(MIN_SIZE, r.w);
    let h = w / aspect;
    if (h > src.h) { h = src.h; w = h * aspect; }
    if (w > src.w) { w = src.w; h = w / aspect; }
    const x = Math.min(Math.max(0, r.x), src.w - w);
    const y = Math.min(Math.max(0, r.y), src.h - h);
    return { x, y, w, h };
  }

  // Seitenverhältnis anpassen, Mittelpunkt und Fläche bleiben ungefähr gleich
  function fitToAspect(r, aspect) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const area = r.w * r.h;
    const w = Math.sqrt(area * aspect);
    const h = w / aspect;
    return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }, aspect);
  }

  function defaultGame(aspect) {
    const h = src.h;
    const w = h * aspect;
    return clampRect({ x: (src.w - w) / 2, y: 0, w, h }, aspect);
  }

  function defaultCam() {
    const w = src.w * 0.24;
    return { x: src.w * 0.015, y: src.h * 0.02, w, h: w / (16 / 9) };
  }

  function aspectOf(t) {
    return t.w / t.h;
  }

  // Webcam-Rahmen in erlaubter Form halten (nicht zu flach, nicht zu hoch)
  function limitCam(r, anchorBottom) {
    const lim = camAspectLimits();
    const a = r.w / r.h;
    let h = r.h;
    if (a < lim.min) h = r.w / lim.min;
    if (a > lim.max) h = r.w / lim.max;
    h = Math.min(h, src.h);
    const y = anchorBottom ? r.y + r.h - h : r.y;
    return { x: r.x, y: Math.min(Math.max(0, y), src.h - h), w: r.w, h };
  }

  // Gameplay-Rahmen an den Platz anpassen, den die Webcam übrig lässt
  function syncGame() {
    const t = targets();
    rects.game = rects.game ? fitToAspect(rects.game, aspectOf(t.game)) : defaultGame(aspectOf(t.game));
  }

  function applyLayout() {
    if (layout === '2' && !rects.cam) rects.cam = defaultCam();
    if (rects.cam) rects.cam = limitCam(rects.cam);
    syncGame();
    for (const b of $('layout').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === layout));
    for (const b of $('cam-pos').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === camPos));
    $('cam-pos-section').classList.toggle('hidden', layout !== '2');
    renderOverlay();
    saveCrop();
  }

  // ---------- Merken pro Streamer ----------

  function cropKey() {
    return 'crop_' + (job.streamerLogin || job.streamer || 'default').toLowerCase();
  }

  async function loadCrop() {
    try {
      const key = cropKey();
      const saved = (await chrome.storage.local.get(key))[key];
      if (!saved) return;
      if (job.layout == null && saved.layout) layout = saved.layout;
      if (saved.camPos) camPos = saved.camPos;
      const scale = (r) => r && { x: r.x * src.w, y: r.y * src.h, w: r.w * src.w, h: r.h * src.h };
      rects.game = scale(saved.game);
      rects.cam = scale(saved.cam);
    } catch (e) { /* ohne gespeicherte Werte starten */ }
  }

  let saveTimer = null;
  function saveCrop() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const norm = (r) => r && { x: r.x / src.w, y: r.y / src.h, w: r.w / src.w, h: r.h / src.h };
      try {
        chrome.storage.local.set({ [cropKey()]: { layout, camPos, game: norm(rects.game), cam: norm(rects.cam) } });
      } catch (e) { /* egal */ }
    }, 300);
  }

  // ---------- Rahmen auf dem Original ----------

  function renderOverlay() {
    const overlay = $('overlay');
    if (mode !== 'portrait') { overlay.textContent = ''; return; }
    const scale = overlay.clientWidth / src.w;
    const t = targets();
    for (const name of ['game', 'cam']) {
      let el = overlay.querySelector('.crop.' + name);
      if (!t[name]) {
        if (el) el.remove();
        continue;
      }
      if (!el) el = createCropElement(name);
      const r = rects[name];
      el.style.left = r.x * scale + 'px';
      el.style.top = r.y * scale + 'px';
      el.style.width = r.w * scale + 'px';
      el.style.height = r.h * scale + 'px';
    }
  }

  // Griffe: Ecken und Kanten. dir.x/dir.y: -1 = links/oben, 1 = rechts/unten, 0 = bleibt
  const HANDLES = {
    nw: { x: -1, y: -1 }, n: { x: 0, y: -1 }, ne: { x: 1, y: -1 }, e: { x: 1, y: 0 },
    se: { x: 1, y: 1 }, s: { x: 0, y: 1 }, sw: { x: -1, y: 1 }, w: { x: -1, y: 0 },
  };

  // Größe ändern. aspect = null heißt frei (Webcam), sonst festes Seitenverhältnis (Gameplay).
  function resizeRect(r, dir, dx, dy, aspect) {
    // Fixpunkt: gegenüberliegende Kante bzw. Mitte
    const ax = dir.x === 1 ? r.x : dir.x === -1 ? r.x + r.w : r.x + r.w / 2;
    const ay = dir.y === 1 ? r.y : dir.y === -1 ? r.y + r.h : r.y + r.h / 2;
    const room = (d, a, size) => (d === 1 ? size - a : d === -1 ? a : 2 * Math.min(a, size - a));
    const maxW = room(dir.x, ax, src.w);
    const maxH = room(dir.y, ay, src.h);

    let w = r.w + dir.x * dx;
    let h = r.h + dir.y * dy;
    if (aspect) {
      if (dir.x && dir.y) w = Math.max(w, h * aspect);
      else if (!dir.x) w = h * aspect;
      w = Math.min(Math.max(MIN_SIZE, w), maxW, maxH * aspect);
      h = w / aspect;
    } else {
      w = dir.x ? Math.min(Math.max(MIN_SIZE, w), maxW) : r.w;
      h = dir.y ? Math.min(Math.max(MIN_SIZE, h), maxH) : r.h;
    }
    const x = dir.x === 1 ? ax : dir.x === -1 ? ax - w : ax - w / 2;
    const y = dir.y === 1 ? ay : dir.y === -1 ? ay - h : ay - h / 2;
    return { x, y, w, h };
  }

  function createCropElement(name) {
    const el = document.createElement('div');
    el.className = 'crop ' + name;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = name === 'game' ? 'Gameplay' : 'Webcam';
    el.append(tag);
    for (const key of Object.keys(HANDLES)) {
      const h = document.createElement('span');
      h.className = 'handle ' + key;
      h.dataset.dir = key;
      el.append(h);
    }
    $('overlay').append(el);

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const dir = e.target.dataset.dir ? HANDLES[e.target.dataset.dir] : null;
      const scale = $('overlay').clientWidth / src.w;
      const start = { x: e.clientX, y: e.clientY, r: { ...rects[name] } };

      const move = (ev) => {
        const dx = (ev.clientX - start.x) / scale;
        const dy = (ev.clientY - start.y) / scale;
        const r = start.r;
        if (name === 'cam') {
          if (dir) rects.cam = limitCam(resizeRect(r, dir, dx, dy, null), dir.y === -1);
          else rects.cam = { ...r, x: Math.min(Math.max(0, r.x + dx), src.w - r.w), y: Math.min(Math.max(0, r.y + dy), src.h - r.h) };
          syncGame(); // Gameplay passt sich an den Platz unter der Webcam an
        } else {
          const aspect = aspectOf(targets().game);
          rects.game = dir ? resizeRect(r, dir, dx, dy, aspect) : clampRect({ ...r, x: r.x + dx, y: r.y + dy }, aspect);
        }
        renderOverlay();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        saveCrop();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    return el;
  }

  // ---------- Vorschau ----------

  // Was zum Zeitpunkt t wohin ins fertige Bild kommt (nur Hochformat)
  function planAt() {
    const tg = targets();
    return ['cam', 'game'].filter((n) => tg[n]).map((n) => ({ src: rects[n], dst: tg[n] }));
  }

  function drawPreview() {
    const video = $('video');
    const canvas = $('preview');
    const ctx = canvas.getContext('2d');
    const k = canvas.width / out.w;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (video.readyState >= 2) {
      for (const p of planAt()) {
        ctx.drawImage(video, p.src.x, p.src.y, p.src.w, p.src.h, p.dst.x * k, p.dst.y * k, p.dst.w * k, p.dst.h * k);
      }
    }
    requestAnimationFrame(drawPreview);
  }

  // ---------- Abspielen ----------

  function bindTransport() {
    const video = $('video');
    const toggle = () => (video.paused ? video.play() : video.pause());
    $('play').addEventListener('click', toggle);
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        toggle();
      }
    });
    video.addEventListener('play', () => { $('icon-play').classList.add('hidden'); $('icon-pause').classList.remove('hidden'); });
    video.addEventListener('pause', () => { $('icon-play').classList.remove('hidden'); $('icon-pause').classList.add('hidden'); });
    video.addEventListener('loadedmetadata', () => {
      $('time').textContent = formatTime(0) + ' / ' + formatTime(video.duration);
    });
    const showTime = () => {
      $('time').textContent = ClipTimeline.formatTime(video.currentTime) + ' / ' + ClipTimeline.formatTime(video.duration);
    };
    video.addEventListener('timeupdate', showTime);
    video.addEventListener('seeked', showTime);
  }

  // ---------- Export ----------

  async function exportVideo() {
    const name = cleanName($('filename').value) || 'Clip';
    $('export').disabled = true;
    $('export-progress').classList.remove('hidden');
    $('status').classList.add('hidden');
    $('video').pause();
    setBar('export', 0);
    document.title = 'Wird erstellt … – Shorty';

    try {
      const options = { cuts: timeline.removed() };
      if (mode === 'portrait') {
        options.output = { width: out.w, height: out.h };
        options.regions = planAt().map((p) => ({
          src: { x: Math.round(p.src.x), y: Math.round(p.src.y), w: Math.round(p.src.w), h: Math.round(p.src.h) },
          dst: p.dst,
        }));
      }
      const blob = await ClipTranscoder.toH264(buffer.slice(0), (p) => setBar('export', p), options);
      setBar('export', 1, '✓');
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({ url, filename: name + '.mp4', conflictAction: 'uniquify' });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      document.title = 'Fertig ✓ – Shorty';
      setStatus('Fertig! „' + name + '.mp4“ liegt in deinem Download-Ordner. Du kannst noch etwas ändern und erneut erstellen oder diesen Tab schließen.', 'ok');
    } catch (e) {
      document.title = 'Fehler – Shorty';
      setStatus(e.message || String(e), 'error');
    } finally {
      $('export').disabled = false;
    }
  }

  // ---------- Start ----------

  async function download(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Twitch hat den Download abgelehnt (Fehler ' + res.status + '). Bitte den Clip neu öffnen und nochmal versuchen.');
    const total = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body.getReader();
    const parts = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      // ohne Größenangabe zumindest die geladenen MB zeigen
      onProgress(total ? loaded / total : null, loaded);
    }
    const result = new Uint8Array(loaded);
    let offset = 0;
    for (const p of parts) { result.set(p, offset); offset += p.length; }
    return result.buffer;
  }

  function videoReady(video) {
    return new Promise((resolve, reject) => {
      if (video.readyState >= 2) return resolve();
      video.addEventListener('loadeddata', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('Der Clip kann hier nicht abgespielt werden.')), { once: true });
    });
  }

  async function run() {
    const jobId = new URLSearchParams(location.search).get('job');
    const key = 'job_' + jobId;
    job = jobId && (await chrome.storage.session.get(key))[key];
    if (!job) {
      $('loading').classList.add('hidden');
      setStatus('Kein Clip gefunden. Bitte Shorty über das Symbol in der Leiste neu starten.', 'error');
      return;
    }
    $('title').textContent = job.title || 'Clip';
    $('streamer').textContent = job.streamer || '';
    $('filename').value = cleanName(job.filename);
    mode = job.mode === 'landscape' ? 'landscape' : 'portrait';
    if (job.layout) layout = String(job.layout);
    document.title = (mode === 'portrait' ? 'Hochformat' : 'Schneiden') + ' – Shorty';

    buffer = await download(job.url, (p, bytes) => {
      if (p === null) {
        $('bar-load').style.width = '100%';
        $('bar-load').classList.add('busy');
        $('pct-load').textContent = (bytes / 1e6).toFixed(1).replace('.', ',') + ' MB';
      } else {
        setBar('load', p);
      }
    });
    $('bar-load').classList.remove('busy');
    setBar('load', 1, '✓');

    const video = $('video');
    video.src = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }));
    await videoReady(video);
    src = { w: video.videoWidth, h: video.videoHeight };
    out = src.h >= 1000 ? { w: 1080, h: 1920 } : { w: 720, h: 1280 };

    $('layout-section').classList.toggle('hidden', mode !== 'portrait');
    $('help').textContent = (mode === 'portrait' ? 'Zieh die Rahmen an die richtige Stelle, an Ecken und Kanten änderst du die Größe. ' : '')
      + 'Schneiden: Spring an eine Stelle und drück „Schnitt setzen“ (Taste S). Dann einen Teil anklicken und „Teil löschen“ (Entf). '
      + 'Zum genauen Schneiden mit + und − (oder Strg/⌘ + Mausrad) in die Tonspur zoomen, mit ← → bildgenau verschieben. '
      + 'Ein Klick auf eine Schnitt-Linie entfernt den Schnitt, ⌘/Strg + Z macht den letzten Schritt rückgängig.';

    if (mode === 'portrait') {
      await loadCrop();
      if (job.layout) layout = String(job.layout);
    }

    $('loading').classList.add('hidden');
    $('editor').classList.remove('hidden');
    timeline = ClipTimeline.createTimeline({ video, duration: video.duration });
    if (mode === 'portrait') {
      applyLayout();
      drawPreview();
    }

    // Lautstärke messen – für Wellenform und Leerstellen (läuft im Hintergrund)
    ClipTimeline.measureLevels(buffer.slice(0))
      .then(({ levels, step }) => timeline.setLevels(levels, step))
      .catch(() => { /* ohne Ton keine Leerstellen-Suche */ });
  }

  function bind() {
    $('layout').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      layout = b.dataset.value;
      applyLayout();
    });
    $('cam-pos').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      camPos = b.dataset.value;
      applyLayout();
    });
    $('export').addEventListener('click', exportVideo);
    $('filename').addEventListener('keydown', (e) => { if (e.key === 'Enter') exportVideo(); });
    window.addEventListener('resize', () => {
      renderOverlay();
      if (timeline) timeline.redraw();
    });
    bindTransport();
  }

  bind();
  run().catch((e) => {
    $('loading').classList.add('hidden');
    document.title = 'Fehler – Shorty';
    setStatus(e.message || String(e), 'error');
  });
})();
