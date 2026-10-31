// Wandelt eine MP4-Datei (z. B. AV1) komplett im Browser in H.264 um.
// Der Ton (AAC) wird unverändert übernommen, nur das Bild wird neu kodiert.
// Benötigt: lib/mp4box.all.min.js (MP4Box) und lib/mp4-muxer.js (Mp4Muxer).

(function () {
  'use strict';

  function boxDescription(entry) {
    const box = entry.avcC || entry.hvcC || entry.av1C || entry.vpcC;
    if (!box) return undefined;
    const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array(stream.buffer, 8); // 8 Byte Box-Kopf überspringen
  }

  function audioDescription(entry) {
    try {
      const dsi = entry.esds.esd.descs[0].descs[0];
      return new Uint8Array(dsi.data);
    } catch (e) {
      return undefined;
    }
  }

  function demux(buffer) {
    return new Promise((resolve, reject) => {
      const file = MP4Box.createFile();
      const samples = {};
      let info = null;
      file.onError = (e) => reject(new Error('Datei konnte nicht gelesen werden: ' + e));
      file.onReady = (i) => {
        info = i;
        for (const t of i.tracks) {
          samples[t.id] = [];
          file.setExtractionOptions(t.id, null, { nbSamples: Infinity });
        }
        file.start();
      };
      file.onSamples = (id, _user, list) => {
        for (const s of list) samples[id].push(s);
      };
      buffer.fileStart = 0;
      file.appendBuffer(buffer);
      file.flush();
      if (!info) return reject(new Error('Datei konnte nicht gelesen werden.'));
      resolve({ file, info, samples });
    });
  }

  // Schnittbereiche sortieren und überlappende zusammenfassen
  function normalizeCuts(list) {
    const sorted = (list || [])
      .filter((c) => c && c.end > c.start)
      .map((c) => ({ start: Math.max(0, c.start), end: c.end }))
      .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const c of sorted) {
      const last = merged[merged.length - 1];
      if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
      else merged.push({ ...c });
    }
    return merged;
  }

  function isH264(codec) {
    return /^avc[13]\./.test(codec || '');
  }

  // Liest nur aus, welchen Bild-Codec eine MP4 hat (z. B. "av01.0.08M.08").
  async function probe(buffer) {
    const { info } = await demux(buffer);
    const v = info.videoTracks[0];
    return { videoCodec: v ? v.codec : null, audioCodec: info.audioTracks[0] ? info.audioTracks[0].codec : null };
  }

  async function pickEncoderConfig(width, height, fps) {
    const pixels = width * height * Math.max(fps, 30);
    // ca. 0,08 Bit pro Pixel – bei 1080p60 rund 10 Mbit/s, etwas mehr als Twitch selbst liefert
    const bitrate = Math.min(20e6, Math.max(3e6, Math.round(pixels * 0.08)));
    const codecs = ['avc1.640033', 'avc1.64002A', 'avc1.640028', 'avc1.4D0033', 'avc1.42E033'];
    for (const codec of codecs) {
      for (const hw of ['prefer-hardware', 'no-preference']) {
        const config = {
          codec, width, height, bitrate, framerate: fps,
          hardwareAcceleration: hw, avc: { format: 'avc' }, latencyMode: 'quality',
        };
        try {
          const res = await VideoEncoder.isConfigSupported(config);
          if (res.supported) return config;
        } catch (e) { /* nächste Variante probieren */ }
      }
    }
    throw new Error('Dein Browser kann kein H.264 erzeugen.');
  }

  /**
   * @param {ArrayBuffer} buffer   Original-MP4
   * @param {(p:number)=>void} onProgress  0..1
   * @param {object} [options]
   * @param {{width:number,height:number}} [options.output]  Größe des fertigen Videos
   * @param {{src:{x,y,w,h}, dst:{x,y,w,h}}[] | ((sec:number)=>{src,dst}[])} [options.regions]
   *        Ausschnitte (in Pixeln), die aus dem Original in das neue Bild kopiert werden – z. B.
   *        Webcam oben, Gameplay unten. Als Funktion: Ausschnitte je Zeitpunkt.
   * @param {{start:number,end:number}[]} [options.cuts]  Zeitbereiche in Sekunden, die herausfallen
   * @returns {Promise<Blob>} H.264-MP4
   */
  async function toH264(buffer, onProgress = () => {}, options = {}) {
    if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined') {
      throw new Error('Dieser Browser unterstützt keine Video-Umwandlung. Bitte aktuelles Chrome verwenden.');
    }

    const { file, info, samples } = await demux(buffer);
    const vTrack = info.videoTracks[0];
    const aTrack = info.audioTracks[0];
    if (!vTrack) throw new Error('In der Datei ist kein Bild enthalten.');

    const vEntry = file.getTrackById(vTrack.id).mdia.minf.stbl.stsd.entries[0];
    const vSamples = samples[vTrack.id];
    const regions = typeof options.regions === 'function' || (options.regions && options.regions.length) ? options.regions : null;
    const width = (options.output ? options.output.width : vTrack.video.width) & ~1;
    const height = (options.output ? options.output.height : vTrack.video.height) & ~1;
    const durationSec = vSamples.reduce((s, x) => s + x.duration, 0) / vTrack.timescale;
    const fps = Math.max(1, Math.round(vSamples.length / (durationSec || 1)));

    const decoderConfig = {
      codec: vTrack.codec,
      codedWidth: vTrack.video.width,
      codedHeight: vTrack.video.height,
      description: boxDescription(vEntry),
    };
    const decSupport = await VideoDecoder.isConfigSupported(decoderConfig);
    if (!decSupport.supported) {
      throw new Error('Dein Browser kann dieses Videoformat (' + vTrack.codec + ') nicht lesen.');
    }
    const encoderConfig = await pickEncoderConfig(width, height, fps);

    // Gemeinsamer Nullpunkt für Bild und Ton, damit beides synchron bleibt.
    const firstV = Math.min(...vSamples.map((s) => s.cts / s.timescale));
    const aSamples = aTrack ? samples[aTrack.id] : [];
    const firstA = aSamples.length ? aSamples[0].cts / aSamples[0].timescale : Infinity;
    const base = Math.min(firstV, firstA);
    const us = (ticks, scale) => Math.max(0, Math.round((ticks / scale - base) * 1e6));

    // Schnitte: Zeitpunkt im Original -> Zeitpunkt im fertigen Video (null = fällt raus)
    const cuts = normalizeCuts(options.cuts);
    const mapTime = (sec) => {
      let shift = 0;
      for (const c of cuts) {
        if (sec < c.start) break;
        if (sec < c.end) return null;
        shift += c.end - c.start;
      }
      return sec - shift;
    };
    const keptFrames = vSamples.filter((s) => mapTime(us(s.cts, s.timescale) / 1e6) !== null).length;
    if (!keptFrames) throw new Error('Nach dem Schneiden ist vom Clip nichts mehr übrig.');

    const muxerOptions = {
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate: fps },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'cross-track-offset',
    };
    let aEntry = null;
    if (aTrack) {
      aEntry = file.getTrackById(aTrack.id).mdia.minf.stbl.stsd.entries[0];
      muxerOptions.audio = {
        codec: 'aac',
        numberOfChannels: aTrack.audio.channel_count,
        sampleRate: aTrack.audio.sample_rate,
      };
    }
    const muxer = new Mp4Muxer.Muxer(muxerOptions);

    // Ton 1:1 übernehmen
    if (aTrack) {
      const meta = {
        decoderConfig: {
          codec: aTrack.codec,
          numberOfChannels: aTrack.audio.channel_count,
          sampleRate: aTrack.audio.sample_rate,
          description: audioDescription(aEntry),
        },
      };
      let first = true;
      for (const s of aSamples) {
        const t = mapTime(us(s.cts, s.timescale) / 1e6);
        if (t === null) continue;
        muxer.addAudioChunkRaw(
          new Uint8Array(s.data), 'key',
          Math.round(t * 1e6), Math.round((s.duration / s.timescale) * 1e6),
          first ? meta : undefined,
        );
        first = false;
      }
    }

    // Bild: dekodieren -> neu kodieren
    let failure = null;
    let encoded = 0;
    let frameIndex = 0;
    const keyEvery = Math.max(1, fps * 2);
    const total = keptFrames;

    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        muxer.addVideoChunk(chunk, meta);
        encoded++;
        onProgress(Math.min(1, encoded / total));
      },
      error: (e) => { failure = failure || e; },
    });
    encoder.configure(encoderConfig);

    // Bei Ausschnitten wird jedes Bild auf eine Leinwand gezeichnet und von dort kodiert.
    let canvas = null;
    let ctx = null;
    if (regions) {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingQuality = 'high';
    }
    const compose = (frame, timestamp, sec) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      const list = typeof regions === 'function' ? regions(sec) : regions;
      for (const r of list) {
        ctx.drawImage(frame, r.src.x, r.src.y, r.src.w, r.src.h, r.dst.x, r.dst.y, r.dst.w, r.dst.h);
      }
      return new VideoFrame(canvas, { timestamp, duration: frame.duration ?? undefined });
    };

    const decoder = new VideoDecoder({
      output: (frame) => {
        let out = frame;
        try {
          const t = mapTime(frame.timestamp / 1e6);
          if (t === null) return; // liegt in einem herausgeschnittenen Bereich
          const timestamp = Math.round(t * 1e6);
          if (regions) out = compose(frame, timestamp, frame.timestamp / 1e6);
          else if (timestamp !== frame.timestamp) out = new VideoFrame(frame, { timestamp, duration: frame.duration ?? undefined });
          encoder.encode(out, { keyFrame: frameIndex % keyEvery === 0 });
          frameIndex++;
        } catch (e) {
          failure = failure || e;
        } finally {
          if (out !== frame) out.close();
          frame.close();
        }
      },
      error: (e) => { failure = failure || e; },
    });
    decoder.configure(decoderConfig);

    const waitForQueues = async () => {
      while (decoder.decodeQueueSize > 8 || encoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 4));
        if (failure) return;
      }
    };

    for (const s of vSamples) {
      if (failure) break;
      decoder.decode(new EncodedVideoChunk({
        type: s.is_sync ? 'key' : 'delta',
        timestamp: us(s.cts, s.timescale),
        duration: Math.round((s.duration / s.timescale) * 1e6),
        data: s.data,
      }));
      await waitForQueues();
    }
    if (!failure) await decoder.flush();
    if (!failure) await encoder.flush();
    decoder.close();
    encoder.close();
    if (failure) throw new Error('Umwandlung fehlgeschlagen: ' + (failure.message || failure));

    muxer.finalize();
    onProgress(1);
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  }

  self.ClipTranscoder = { toH264, probe, isH264, normalizeCuts };
})();
