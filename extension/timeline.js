// Zeitleiste für den Editor: Schnitte setzen, Teile auswählen und löschen, Leerstellen finden,
// in die Tonspur hineinzoomen und Schritte rückgängig machen.
// Der Clip wird durch Schnitte in Teile zerlegt; jeder Teil ist entweder drin oder gelöscht.
// Alle Zeiten in Sekunden, bezogen auf die Zeit des <video>-Elements.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MIN_PART = 0.05; // kürzer dürfen Teile nicht werden
  const MIN_VIEW = 0.5; // so weit darf man höchstens hineinzoomen (sichtbare Sekunden)
  const STEP = 1 / 30; // Pfeiltaste: ein Bild weiter

  function formatTime(sec) {
    const s = Math.max(0, sec || 0);
    const m = Math.floor(s / 60);
    const rest = s - m * 60;
    return m + ':' + rest.toFixed(1).padStart(4, '0').replace('.', ',');
  }

  function createTimeline({ video, duration }) {
    const bar = $('timeline');
    const state = {
      points: [], // Schnittstellen, sortiert
      deleted: [false], // je Teil: gelöscht?
      selected: -1, // ausgewählter Teil
      history: [], // frühere Stände für „Rückgängig“
      view: { start: 0, end: duration }, // sichtbarer Ausschnitt der Zeitleiste
      levels: null,
      levelStep: 0.01,
    };

    // ---------- Umrechnung Zeit <-> Position (abhängig vom Zoom) ----------
    const span = () => state.view.end - state.view.start;
    const timeAt = (clientX) => {
      const r = bar.getBoundingClientRect();
      const t = state.view.start + ((clientX - r.left) / r.width) * span();
      return Math.min(duration, Math.max(0, t));
    };
    const pos = (t) => ((t - state.view.start) / span()) * 100 + '%';
    const len = (d) => (d / span()) * 100 + '%';

    // ---------- Teile ----------
    function parts() {
      const edges = [0, ...state.points, duration];
      return edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1], deleted: state.deleted[i] }));
    }

    function partIndexAt(t) {
      let i = 0;
      while (i < state.points.length && t >= state.points[i]) i++;
      return i;
    }

    // Stand merken, bevor sich etwas ändert
    function remember() {
      state.history.push({ points: state.points.slice(), deleted: state.deleted.slice(), selected: state.selected });
      if (state.history.length > 200) state.history.shift();
    }

    function undo() {
      const prev = state.history.pop();
      if (!prev) return;
      state.points = prev.points;
      state.deleted = prev.deleted;
      state.selected = prev.selected;
      render();
    }

    // Schnitt bei t setzen; beide Hälften behalten den Zustand des alten Teils
    function addCut(t) {
      if (t <= MIN_PART || t >= duration - MIN_PART) return false;
      if (state.points.some((p) => Math.abs(p - t) < MIN_PART)) return false;
      const i = partIndexAt(t);
      state.points.splice(i, 0, t);
      state.deleted.splice(i, 0, state.deleted[i]);
      if (state.selected > i) state.selected++;
      return true;
    }

    // Schnitt entfernen: die zwei Teile werden wieder einer (gelöscht nur, wenn beide gelöscht waren)
    function removeCut(index) {
      const merged = state.deleted[index] && state.deleted[index + 1];
      state.points.splice(index, 1);
      state.deleted.splice(index, 2, merged);
      state.selected = -1;
    }

    function removed() {
      return ClipTranscoder.normalizeCuts(parts().filter((p) => p.deleted).map((p) => ({ start: p.start, end: p.end })));
    }

    function keptDuration() {
      return parts().filter((p) => !p.deleted).reduce((s, p) => s + p.end - p.start, 0);
    }

    // ---------- Zeichnen ----------
    function render() {
      const box = $('parts');
      box.textContent = '';
      parts().forEach((p, i) => {
        if (p.end < state.view.start || p.start > state.view.end) return;
        const el = document.createElement('div');
        el.className = 'part' + (p.deleted ? ' deleted' : '') + (i === state.selected ? ' selected' : '');
        el.style.left = pos(p.start);
        el.style.width = len(p.end - p.start);
        box.append(el);
      });

      const marks = $('cut-marks');
      marks.textContent = '';
      state.points.forEach((t, i) => {
        if (t < state.view.start || t > state.view.end) return;
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'cut-mark';
        el.style.left = pos(t);
        el.dataset.index = i;
        el.title = 'Schnitt bei ' + formatTime(t) + ' – klicken zum Entfernen';
        marks.append(el);
      });

      const sel = parts()[state.selected];
      $('delete-part').disabled = !sel;
      $('delete-part-label').textContent = sel && sel.deleted ? 'Teil wiederherstellen' : 'Teil löschen';
      $('undo').disabled = !state.history.length;

      const kept = keptDuration();
      $('new-length').textContent = kept < duration - 0.05
        ? 'Neue Länge ' + formatTime(kept) + ' (vorher ' + formatTime(duration) + ')'
        : 'Länge ' + formatTime(duration);

      renderZoom();
      drawWave();
    }

    function renderZoom() {
      const zoomed = span() < duration - 1e-6;
      $('overview').classList.toggle('hidden', !zoomed);
      $('view-window').style.left = (state.view.start / duration) * 100 + '%';
      $('view-window').style.width = (span() / duration) * 100 + '%';
      $('tl-zoom-label').textContent = zoomed ? Math.round(duration / span()) + '× · ' + span().toFixed(1).replace('.', ',') + ' s' : 'Ganzer Clip';
      $('tl-zoom-out').disabled = !zoomed;
      $('tl-zoom-fit').disabled = !zoomed;
      $('tl-zoom-in').disabled = span() <= MIN_VIEW + 1e-6;
    }

    // Abstand der Zeitmarken passend zum Zoom
    function tickStep() {
      const target = span() / 8;
      for (const s of [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (s >= target) return s;
      return 120;
    }

    function drawWave() {
      const canvas = $('wave');
      const w = Math.round(canvas.clientWidth * devicePixelRatio);
      const h = Math.round(canvas.clientHeight * devicePixelRatio);
      if (!w || !h) return;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      const { start, end } = state.view;

      // Zeitmarken
      const step = tickStep();
      ctx.font = 10 * devicePixelRatio + 'px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      for (let t = Math.ceil(start / step) * step; t <= end + 1e-6; t += step) {
        const x = Math.round(((t - start) / (end - start)) * w);
        ctx.fillStyle = 'rgba(255, 255, 255, .09)';
        ctx.fillRect(x, 0, 1, h);
        ctx.fillStyle = 'rgba(255, 255, 255, .45)';
        const label = step < 1 ? formatTime(t) : formatTime(t).replace(/,\d$/, '');
        ctx.fillText(label, x + 3 * devicePixelRatio, 3 * devicePixelRatio);
      }

      if (!state.levels) return;
      // Wellenform: je Pixel der lauteste Wert in diesem Zeitraum
      ctx.fillStyle = 'rgba(149, 128, 255, .6)';
      const lv = state.levels;
      const max = state.levelMax;
      const top = 14 * devicePixelRatio;
      const areaH = h - top;
      for (let x = 0; x < w; x++) {
        const t0 = start + (x / w) * (end - start);
        const t1 = start + ((x + 1) / w) * (end - start);
        let i0 = Math.floor(t0 / state.levelStep);
        const i1 = Math.max(i0 + 1, Math.ceil(t1 / state.levelStep));
        let peak = 0;
        for (; i0 < i1 && i0 < lv.length; i0++) if (lv[i0] > peak) peak = lv[i0];
        const v = Math.sqrt(peak / max); // Wurzel, damit leise Stellen sichtbar bleiben
        const bh = Math.max(1, v * areaH * 0.92);
        ctx.fillRect(x, top + (areaH - bh) / 2, 1, bh);
      }
    }

    // ---------- Zoomen ----------
    function setView(start, end) {
      let s = Math.max(MIN_VIEW, Math.min(duration, end - start));
      let a = Math.max(0, Math.min(start, duration - s));
      state.view = { start: a, end: a + s };
      render();
    }

    // um den Zeitpunkt `around` zoomen (factor < 1 = hinein)
    function zoomBy(factor, around) {
      const s = Math.max(MIN_VIEW, Math.min(duration, span() * factor));
      const rel = (around - state.view.start) / span();
      setView(around - rel * s, around - rel * s + s);
    }

    $('tl-zoom-in').addEventListener('click', () => zoomBy(0.5, video.currentTime));
    $('tl-zoom-out').addEventListener('click', () => zoomBy(2, video.currentTime));
    $('tl-zoom-fit').addEventListener('click', () => setView(0, duration));

    // Strg/⌘ + Mausrad oder Trackpad-Spreizen zoomt, seitliches Wischen verschiebt
    bar.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomBy(Math.exp(e.deltaY * 0.01), timeAt(e.clientX));
      } else {
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const r = bar.getBoundingClientRect();
        const shift = (d / r.width) * span();
        setView(state.view.start + shift, state.view.end + shift);
      }
    }, { passive: false });

    // Übersicht: Fenster ziehen oder irgendwo hinklicken
    $('overview').addEventListener('pointerdown', (e) => {
      const ov = $('overview');
      ov.setPointerCapture(e.pointerId);
      const r = ov.getBoundingClientRect();
      const toTime = (x) => ((x - r.left) / r.width) * duration;
      const onWindow = e.target.id === 'view-window';
      const offset = onWindow ? toTime(e.clientX) - state.view.start : span() / 2;
      const move = (ev) => {
        const s = toTime(ev.clientX) - offset;
        setView(s, s + span());
      };
      const up = () => {
        ov.removeEventListener('pointermove', move);
        ov.removeEventListener('pointerup', up);
      };
      ov.addEventListener('pointermove', move);
      ov.addEventListener('pointerup', up);
      move(e);
    });

    // ---------- Aktionen ----------
    function cutAtPlayhead() {
      const t = video.currentTime;
      if (t <= MIN_PART || t >= duration - MIN_PART || state.points.some((p) => Math.abs(p - t) < MIN_PART)) return;
      remember();
      addCut(t);
      state.selected = partIndexAt(t);
      render();
    }

    function toggleSelected() {
      if (state.selected < 0) return;
      remember();
      state.deleted[state.selected] = !state.deleted[state.selected];
      // Nach dem Löschen zum nächsten Teil springen, der drin ist
      if (state.deleted[state.selected]) {
        const next = parts().find((p, i) => i > state.selected && !p.deleted);
        if (next) video.currentTime = next.start;
      }
      render();
    }

    function stepBy(d) {
      video.pause();
      video.currentTime = Math.min(duration, Math.max(0, video.currentTime + d));
      state.selected = partIndexAt(video.currentTime);
      render();
    }

    $('add-cut').addEventListener('click', cutAtPlayhead);
    $('delete-part').addEventListener('click', toggleSelected);
    $('undo').addEventListener('click', undo);
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
      if (mod) return;
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); cutAtPlayhead(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); toggleSelected(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepBy(e.shiftKey ? -1 : -STEP); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepBy(e.shiftKey ? 1 : STEP); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(0.5, video.currentTime); }
      else if (e.key === '-') { e.preventDefault(); zoomBy(2, video.currentTime); }
      else if (e.key === '0') { e.preventDefault(); setView(0, duration); }
    });

    // ---------- Maus/Touch auf der Zeitleiste ----------
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // Schnitt-Markierung anklicken = Schnitt entfernen
      if (e.target.classList.contains('cut-mark')) {
        remember();
        removeCut(Number(e.target.dataset.index));
        render();
        return;
      }
      bar.setPointerCapture(e.pointerId);
      const seek = (ev) => {
        const t = timeAt(ev.clientX);
        video.currentTime = t;
        state.selected = partIndexAt(t);
        render();
      };
      const up = () => {
        bar.removeEventListener('pointermove', seek);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
      };
      bar.addEventListener('pointermove', seek);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
      seek(e);
    });

    // ---------- Leerstellen ----------
    $('find-silence').addEventListener('click', () => {
      if (!state.levels) return;
      const found = findSilence(state.levels, state.levelStep, Number($('silence-length').value), Number($('silence-level').value));
      if (found.length) remember();
      for (const r of found) {
        addCut(r.start);
        addCut(r.end);
        state.deleted[partIndexAt((r.start + r.end) / 2)] = true;
      }
      const total = found.reduce((s, c) => s + c.end - c.start, 0);
      $('silence-result').textContent = found.length
        ? found.length + (found.length === 1 ? ' Stelle' : ' Stellen') + ' gelöscht (' + total.toFixed(1).replace('.', ',') + ' s). „Rückgängig“ holt sie zurück.'
        : 'Keine Leerstellen gefunden. Versuch eine kürzere Mindestlänge oder stell „Was zählt als still?“ höher.';
      render();
    });
    for (const id of ['silence-length', 'silence-level']) {
      $(id).addEventListener('input', () => {
        $(id + '-value').textContent = id === 'silence-length'
          ? Number($(id).value).toFixed(1).replace('.', ',') + ' s'
          : sensitivityLabel(Number($(id).value));
      });
    }

    window.addEventListener('resize', drawWave);

    // Abspielen: gelöschte Teile überspringen, gezoomte Ansicht läuft mit
    function loop() {
      const t = video.currentTime;
      if (!video.paused) {
        const p = parts()[partIndexAt(t)];
        if (p && p.deleted) {
          const next = parts().find((q) => q.start >= p.end - 1e-6 && !q.deleted);
          if (next) video.currentTime = next.start;
          else video.pause();
        }
        if (t > state.view.end || t < state.view.start) setView(t - span() * 0.1, t + span() * 0.9);
      }
      const ph = $('playhead');
      const visible = t >= state.view.start && t <= state.view.end;
      ph.style.display = visible ? '' : 'none';
      if (visible) ph.style.left = pos(t);
      requestAnimationFrame(loop);
    }
    loop();

    render();

    return {
      removed,
      setLevels(levels, step) {
        state.levels = levels;
        state.levelStep = step;
        state.levelMax = Math.max(1e-6, ...levels);
        $('silence-box').classList.remove('hidden');
        drawWave();
      },
      redraw: drawWave,
    };
  }

  function sensitivityLabel(db) {
    if (db <= -45) return 'nur ganz still';
    if (db <= -38) return 'normal';
    if (db <= -32) return 'auch leises Reden';
    return 'sehr empfindlich';
  }

  // Lautstärke (RMS) in kleinen Fenstern berechnen – fein genug, um beim Zoomen Silben zu sehen
  async function measureLevels(arrayBuffer, step = 0.01) {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Ctx(1, 44100, 44100);
    const audio = await ctx.decodeAudioData(arrayBuffer);
    const rate = audio.sampleRate;
    const win = Math.max(1, Math.round(rate * step));
    const n = Math.ceil(audio.length / win);
    const levels = new Float32Array(n);
    const channels = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let count = 0;
      const end = Math.min(audio.length, (i + 1) * win);
      for (let j = i * win; j < end; j++) {
        for (const ch of channels) { sum += ch[j] * ch[j]; count++; }
      }
      levels[i] = count ? Math.sqrt(sum / count) : 0;
    }
    return { levels, step: win / rate };
  }

  // Stille Bereiche finden: leiser als thresholdDb für mindestens minLen Sekunden.
  // Am Rand bleibt etwas Luft, damit Wörter nicht abgehackt werden.
  function findSilence(levels, step, minLen, thresholdDb) {
    const limit = Math.pow(10, thresholdDb / 20);
    const pad = 0.15;
    const result = [];
    let start = null;
    for (let i = 0; i <= levels.length; i++) {
      const quiet = i < levels.length && levels[i] < limit;
      if (quiet && start === null) start = i;
      if (!quiet && start !== null) {
        const s = start * step;
        const e = i * step;
        if (e - s >= minLen) result.push({ start: s + pad, end: e - pad });
        start = null;
      }
    }
    return result.filter((c) => c.end - c.start > 0.1);
  }

  self.ClipTimeline = { createTimeline, measureLevels, findSilence, formatTime, sensitivityLabel };
})();
