// Alles, was mit Twitch selbst zu tun hat: Clip-Link erkennen und Clip-Daten abfragen.

(function () {
  'use strict';

  // Öffentliche Client-ID der Twitch-Webseite (dieselbe, die twitch.tv im Browser nutzt).
  const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

  function slugFromUrl(input) {
    if (!input) return null;
    let url;
    try {
      url = new URL(input.trim().startsWith('http') ? input.trim() : 'https://' + input.trim());
    } catch (e) {
      return null;
    }
    const host = url.hostname.replace(/^www\.|^m\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'clips.twitch.tv') {
      if (parts[0] === 'embed') return url.searchParams.get('clip');
      return parts[0] || null;
    }
    if (host === 'twitch.tv') {
      const i = parts.indexOf('clip');
      if (i !== -1 && parts[i + 1]) return parts[i + 1];
    }
    return null;
  }

  async function gql(query, variables) {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error('Twitch antwortet nicht (Fehler ' + res.status + ').');
    const json = await res.json();
    if (json.errors && !json.data) throw new Error('Twitch-Fehler: ' + json.errors[0].message);
    return json.data;
  }

  const CLIP_QUERY = `query($slug: ID!) {
    clip(slug: $slug) {
      slug title durationSeconds createdAt
      thumbnailURL(width: 480, height: 272)
      broadcaster { displayName login }
      playbackAccessToken(params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) { signature value }
      videoQualities { quality frameRate codecs sourceURL }
      assets { type aspectRatio videoQualities { quality frameRate codecs sourceURL } }
    }
  }`;

  function codecLabel(codecs) {
    const c = (codecs || '').toLowerCase();
    if (c.startsWith('av01')) return 'AV1';
    if (c.startsWith('hvc1') || c.startsWith('hev1')) return 'HEVC';
    if (c.startsWith('avc1') || c.startsWith('avc3')) return 'H.264';
    if (c.startsWith('vp09')) return 'VP9';
    return c ? c.split('.')[0].toUpperCase() : 'unbekannt';
  }

  async function getClip(slug) {
    const data = await gql(CLIP_QUERY, { slug });
    const clip = data && data.clip;
    if (!clip) throw new Error('Clip nicht gefunden. Ist der Link richtig und der Clip öffentlich?');
    const token = clip.playbackAccessToken;
    if (!token) throw new Error('Twitch gibt diesen Clip nicht zum Download frei.');
    const sign = (u) => u + (u.includes('?') ? '&' : '?') + 'sig=' + encodeURIComponent(token.signature) + '&token=' + encodeURIComponent(token.value);

    const toVariant = (q) => ({
      quality: q.quality,
      fps: Math.round(q.frameRate || 0),
      codec: codecLabel(q.codecs),
      url: sign(q.sourceURL),
    });
    const sortByQuality = (a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0) || b.fps - a.fps;

    // assets: SOURCE = Querformat, RECOMPOSED = automatisch erzeugtes Hochformat
    const orientations = {};
    for (const a of clip.assets || []) {
      const key = a.type === 'RECOMPOSED' || (a.aspectRatio && a.aspectRatio < 1) ? 'portrait' : 'landscape';
      if (!orientations[key] && a.videoQualities && a.videoQualities.length) {
        orientations[key] = a.videoQualities.map(toVariant).sort(sortByQuality);
      }
    }
    if (!orientations.landscape && clip.videoQualities && clip.videoQualities.length) {
      orientations.landscape = clip.videoQualities.map(toVariant).sort(sortByQuality);
    }
    if (!orientations.landscape && !orientations.portrait) {
      throw new Error('Für diesen Clip gibt es keine Videodatei.');
    }

    return {
      slug: clip.slug,
      title: clip.title || clip.slug,
      streamer: clip.broadcaster ? clip.broadcaster.displayName : '',
      streamerLogin: clip.broadcaster ? clip.broadcaster.login : '',
      createdAt: clip.createdAt || '',
      duration: clip.durationSeconds || 0,
      thumbnail: clip.thumbnailURL,
      orientations,
    };
  }

  function cleanName(s) {
    return (s || '').replace(/\.mp4$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // aus "Größter Clutch!" wird "groessterclutch": klein, ohne Leer- und Sonderzeichen
  function compact(s) {
    return (s || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  // Tag, an dem der Clip auf Twitch erstellt wurde, als 20102026 (Tag Monat Jahr; unbekannt: leer)
  function dateTag(iso) {
    const d = new Date(iso || NaN);
    if (isNaN(d)) return '';
    return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + d.getFullYear();
  }

  // Vorschlag für den Dateinamen (ohne .mp4): Datum + erste 5 Buchstaben des Clip-Titels,
  // z. B. "02032025_groes"
  function suggestName(clip) {
    const start = compact(clip.title).slice(0, 5) || compact(clip.streamer).slice(0, 5) || 'clip';
    return [dateTag(clip.createdAt), start].filter(Boolean).join('_');
  }

  self.Twitch = { slugFromUrl, getClip, suggestName, cleanName };
})();
