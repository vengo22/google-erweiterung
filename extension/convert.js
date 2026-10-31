(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function setStep(name, fraction, state) {
    const li = $('step-' + name);
    li.classList.toggle('active', state === 'active');
    li.classList.toggle('done', state === 'done');
    if (fraction != null) {
      $('bar-' + name).style.width = Math.round(fraction * 100) + '%';
      $('pct-' + name).textContent = state === 'done' ? '✓' : Math.round(fraction * 100) + ' %';
    }
  }

  function setStatus(text, kind) {
    const s = $('status');
    s.className = 'note' + (kind ? ' ' + kind : '');
    s.textContent = text;
  }

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
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const p of parts) { out.set(p, offset); offset += p.length; }
    return out.buffer;
  }

  async function save(blob, filename) {
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
    // Blob erst später freigeben, damit Chrome die Datei fertig schreiben kann
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function run() {
    const jobId = new URLSearchParams(location.search).get('job');
    const key = 'job_' + jobId;
    const job = jobId && (await chrome.storage.session.get(key))[key];
    if (!job) {
      setStatus('Kein Clip gefunden. Bitte Shorty über das Symbol in der Leiste neu starten.', 'error');
      return;
    }

    $('title').textContent = job.title || job.filename;
    $('streamer').textContent = job.streamer || '';
    if (job.thumbnail) $('thumb').src = job.thumbnail;
    document.title = 'Wird umgewandelt … – ' + (job.title || 'Clip');

    setStep('load', 0, 'active');
    const buffer = await download(job.url, (p, bytes) => {
      if (p === null) {
        $('bar-load').style.width = '100%';
        $('bar-load').classList.add('busy');
        $('pct-load').textContent = (bytes / 1e6).toFixed(1).replace('.', ',') + ' MB';
      } else {
        setStep('load', p, 'active');
      }
    });
    $('bar-load').classList.remove('busy');
    setStep('load', 1, 'done');

    // Falls Twitch doch schon H.264 geliefert hat, nichts umwandeln.
    const probe = await ClipTranscoder.probe(buffer.slice(0));
    let blob;
    if (ClipTranscoder.isH264(probe.videoCodec)) {
      setStep('convert', 1, 'done');
      $('pct-convert').textContent = 'nicht nötig';
      blob = new Blob([buffer], { type: 'video/mp4' });
    } else {
      setStep('convert', 0, 'active');
      blob = await ClipTranscoder.toH264(buffer, (p) => setStep('convert', p, 'active'));
      setStep('convert', 1, 'done');
    }

    await save(blob, job.filename);
    chrome.storage.session.remove(key);
    document.title = 'Fertig ✓ – ' + (job.title || 'Clip');
    setStatus('Fertig! Der Clip liegt in deinem Download-Ordner und läuft in jedem Schnittprogramm. Du kannst diesen Tab jetzt schließen.', 'ok');
  }

  run().catch((e) => {
    document.title = 'Fehler – Shorty';
    setStatus(e.message || String(e), 'error');
  });
})();
