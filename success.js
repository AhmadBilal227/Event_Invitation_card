function tryOpenLinkedInApp(sharePageUrl) {
  const webUrl = linkedinShareUrl(sharePageUrl);
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  let fallbackTimer;
  const clear = () => {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    window.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pagehide', onHide);
  };
  const onVis = () => { if (document.hidden) clear(); };
  const onHide = () => { clear(); };
  window.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);

  fallbackTimer = setTimeout(() => {
    clear();
    window.location.href = webUrl;
  }, 1200);

  try {
    if (isAndroid) {
      const intentUrl = `intent://shareArticle?mini=true&url=${encodeURIComponent(sharePageUrl)}&title=${encodeURIComponent(EVENT.title)}#Intent;scheme=linkedin;package=com.linkedin.android;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
      window.location.href = intentUrl;
    } else if (isIOS) {
      const appUrl = `linkedin://shareArticle?mini=true&url=${encodeURIComponent(sharePageUrl)}&title=${encodeURIComponent(EVENT.title)}`;
      window.location.href = appUrl;
    } else {
      window.location.href = webUrl;
    }
  } catch (e) {
    clear();
    window.location.href = webUrl;
  }
}
// Diagnostics (top-level) — disabled by default
const DEBUG = false;
function trace(msg, data) {
  try {
    if (!DEBUG) return;
    window.SHARE_TRACE = window.SHARE_TRACE || [];
    window.SHARE_TRACE.push({ t: Date.now(), msg, data });
    console.log('[share]', msg, data || '');
  } catch {}
}
function showDebugPanel(info = {}) {
  if (!DEBUG) return;
  const pre = document.createElement('pre');
  pre.id = 'debugInfo';
  pre.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:9999;max-width:80vw;max-height:50vh;overflow:auto;background:rgba(0,0,0,0.8);color:#fff;padding:8px 10px;border-radius:8px;font-size:12px;white-space:pre-wrap;backdrop-filter:blur(4px)';
  const env = {
    ua: navigator.userAgent,
    canShare: typeof navigator.share === 'function',
    canShareFiles: typeof navigator.canShare === 'function' ? navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }) : 'n/a',
    topLevel: window.top === window,
    referrer: document.referrer || '',
  };
  pre.textContent = 'DEBUG ENV\n' + JSON.stringify({ ...env, ...info }, null, 2) + '\n\nTRACE\n' + JSON.stringify(window.SHARE_TRACE || [], null, 2);
  document.body.appendChild(pre);
}

// success.js — Invitation card success page
// Uses React (UMD globals) and html-to-image UMD to render and export a hi‑res PNG

function b64ToBuf(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.blob();
}

// Wait for images inside a node (brand badge, avatar) with a timeout fallback
function waitForImages(node, timeout = 2000) {
  return new Promise((resolve) => {
    if (!node) return resolve();
    const imgs = Array.from(node.querySelectorAll('img')).filter((i) => !i.complete);
    if (imgs.length === 0) return resolve();
    let left = imgs.length;
    const done = () => { left = 0; resolve(); };
    const onOne = () => { if (--left <= 0) resolve(); };
    imgs.forEach((img) => {
      img.addEventListener('load', onOne, { once: true });
      img.addEventListener('error', onOne, { once: true });
    });
    setTimeout(() => { if (left > 0) done(); }, timeout);
  });
}

let CACHED_SHARE_FILE = null; // File object for quick mobile share
// Render the DOM card to a PNG and swap the stage into image mode
async function renderCardImage() {
  const node = document.getElementById('inviteCard');
  const stage = document.querySelector('.card-stage');
  const imgEl = document.getElementById('cardImage');
  if (!node || !stage || !imgEl) return;
  const hti = await getHtmlToImage();
  if (!hti || typeof hti.toPng !== 'function') return;
  try {
    await waitForImages(node, 2000);
    const dataUrl = await hti.toPng(node, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: 'transparent',
      width: 1200,
      height: 627
    });
    // Keep HTML mode visible; do not switch to image-mode
    try { stage.classList.remove('image-mode'); } catch {}
    // Preload the PNG in the background for fast shares
    imgEl.src = dataUrl;
    // Precompute share file for mobile (avoid losing user gesture on click)
    try {
      const blob = await dataUrlToBlob(dataUrl);
      CACHED_SHARE_FILE = new File([blob], 'ntce-invitation.png', { type: 'image/png' });
    } catch {}
  } catch (e) {
    console.warn('renderCardImage failed', e);
  }
}

// Placeholder avatar (inline SVG data URL)
const PLACEHOLDER_AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="%23e6f3fb"/><circle cx="64" cy="48" r="24" fill="%23b7cfe3"/><path d="M20 108c6-22 26-36 44-36s38 14 44 36" fill="%23b7cfe3"/></svg>';

// Supabase — lazy loaded to avoid blocking card render if CDN is slow
const SUPABASE_URL = 'https://kssqqrunttoblwfopdvj.supabase.co';
let _supabase = null;
async function getSupabase() {
  if (_supabase) return _supabase;
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY) || '';
    _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _supabase;
  } catch (e) {
    console.error('Failed to load Supabase client', e);
    return null;
  }
}

async function uploadCardPng(blob) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Supabase not available');
  const fileName = `card-${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage.from('cards').upload(fileName, blob, {
    contentType: 'image/png',
    upsert: false,
    cacheControl: '31536000'
  });
  if (error) throw error;
  const { data } = supabase.storage.from('cards').getPublicUrl(fileName);
  return { publicUrl: data.publicUrl, fileName };
}

function linkedinShareUrl(sharePageUrl) {
  return 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(sharePageUrl);
}

function buildCaption(fullName, organization) {
  const parts = [
    `Join me at ${EVENT.title}`,
    `${EVENT.dateRange} — ${EVENT.venue}`,
    `${EVENT.hashtag}`,
    `${fullName}${organization ? ' · ' + organization : ''}`,
  ];
  return parts.join('\n');
}

const PRODUCTION_ORIGIN = 'https://ntcepk-event-2025-form.netlify.app';
function fileSlug(name = '') {
  return String(name).replace(/\.(png|jpe?g|webp)$/i, '');
}
function shortShareUrl(fileName, imageUrl = '', title = '', desc = '') {
  const slug = fileSlug(fileName);
  const base = `${PRODUCTION_ORIGIN}/s/${encodeURIComponent(slug)}`;
  const qs = new URLSearchParams();
  if (imageUrl) qs.set('img', imageUrl);
  if (title) qs.set('title', title);
  if (desc) qs.set('desc', desc);
  const q = qs.toString();
  return q ? `${base}?${q}` : base;
}

async function getHtmlToImage() {
  const g = window.htmlToImage;
  if (g && typeof g.toPng === 'function') return g;
  // Fallback to ESM dynamic import if UMD not ready/blocked
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm');
    return mod;
  } catch (e) {
    try {
      const mod = await import('https://unpkg.com/html-to-image@1.11.11/dist/html-to-image.esm.js');
      return mod;
    } catch (e2) {
      console.error('Failed to load html-to-image', e, e2);
      return null;
    }
  }
}

function getRegistration() {
  try {
    const raw = sessionStorage.getItem('registration');
    if (raw) return JSON.parse(raw);
  } catch {}
  const params = new URLSearchParams(location.search);
  const reg = Object.fromEntries(params.entries());
  return reg;
}

// Event constants — adjust as needed
const EVENT = {
  title: 'NTCE 2025 INTERNATIONAL',
  dateRange: '16 – 18 December 2025',
  venue: 'University of Central Punjab',
  hashtag: '#ntce2025',
  cta: 'REGISTER FOR FREE ENTRY TILL 31 OCT',
  stats: [
    { label: 'Diplomats', value: '500+' },
    { label: 'CEOs', value: '50+' },
    { label: 'Tech Talks', value: '25+' },
    { label: 'Exhibits', value: '50+' }
  ],
  // Calendar details (example times in PKT → convert to UTC for Google)
  start: new Date('2025-12-16T09:00:00+05:00'),
  end: new Date('2025-12-18T18:00:00+05:00'),
  location: 'University of Central Punjab, Lahore',
  description: 'Join me at NTCE 2025 — Pakistan\'s Prestigious Construction Industry Event.'
};

function toGoogleDate(dt) {
  // YYYYMMDDTHHMMSSZ in UTC
  const z = new Date(dt).toISOString().replace(/[-:]/g, '').replace('.000', '');
  return z;
}

function googleCalendarUrl(ev) {
  const text = encodeURIComponent(EVENT.title);
  const dates = `${toGoogleDate(EVENT.start)}/${toGoogleDate(EVENT.end)}`;
  const details = encodeURIComponent(EVENT.description);
  const location = encodeURIComponent(EVENT.location);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&details=${details}&location=${location}&sf=true&output=xml`;
}

function buildICS() {
  const toICS = (d) => {
    const iso = new Date(d).toISOString().replace(/[-:]/g, '').replace('.000', '');
    return iso;
  };
  const uid = crypto.randomUUID();
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NTCE//Invitation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toICS(new Date())}`,
    `DTSTART:${toICS(EVENT.start)}`,
    `DTEND:${toICS(EVENT.end)}`,
    `SUMMARY:${EVENT.title}`,
    `DESCRIPTION:${EVENT.description}`,
    `LOCATION:${EVENT.location}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

// Dynamically scale the card-root to fit the stage width when not in image-mode
function fitCardToWidth() {
  try {
    const stage = document.querySelector('.card-stage');
    if (!stage) return;
    if (stage.classList.contains('image-mode')) return;
    const wrap = document.querySelector('.card-wrap');
    const root = document.getElementById('card-root');
    if (!wrap || !root) return;
    const cs = getComputedStyle(stage);
    const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
    const guard = 8; // prevent subpixel overflow on tiny screens
    const available = Math.max(0, stage.clientWidth - pad - guard);
    const scale = Math.min(1, available / 1200);
    const w = Math.round(1200 * scale);
    const hScaled = Math.round(627 * scale);
    wrap.style.width = `${w}px`;
    wrap.style.height = `${hScaled}px`;
    root.style.transformOrigin = 'top left';
    root.style.transform = `scale(${scale})`;
    const h = hScaled + 36;
    stage.style.minHeight = `${h}px`;
  } catch {}
}

function render() {
  try {
    // Read React from window AFTER UMD scripts are loaded
    const React = window.React;
    const ReactDOM = window.ReactDOM;
    if (!React || !ReactDOM) {
      // Fallback to non-React renderer
      const reg = getRegistration();
      const fullName = reg.fullName || reg['fullName'] || '';
      const organization = reg.organization || reg['organization'] || '';
      const avatarUrl = reg.avatarUrl || '';
      renderFallback(fullName, organization, avatarUrl);
      return;
    }

    const BrandIcon = () => (
      React.createElement('img', { src: './ntcepk_logo.jpeg', alt: 'NTCE', className: 'invite-logo' })
    );

    function InviteCard({ fullName, organization, avatarUrl }) {
      // NTCE reference layout inside pc-card (tilt removed, shine kept)
      return (
        React.createElement('div', { id: 'inviteCard', className: 'pc-card-wrapper' },
          React.createElement('section', { id: 'card', className: 'pc-card' },
            React.createElement('div', { className: 'pc-inside' },
              React.createElement('div', { className: 'pc-shine' }),
              React.createElement('div', { className: 'pc-glare' }),
              React.createElement('div', { className: 'ntce-card' },
                // Header row
                React.createElement('div', { className: 'ntce-header' },
                  React.createElement('div', { className: 'ntce-avatar' },
                    React.createElement('img', { src: avatarUrl || PLACEHOLDER_AVATAR, alt: fullName || 'Your photo' })
                  ),
                  React.createElement('div', { className: 'ntce-user' },
                    React.createElement('div', { className: 'ntce-name' }, fullName || 'Your Name'),
                    React.createElement('div', { className: 'ntce-org' }, organization || 'Your Organization')
                  )
                ),
                // Content panel with right watermark and bottom stats inside
                React.createElement('div', { className: 'ntce-panel' },
                  React.createElement('div', { className: 'ntce-panel-grid' },
                    React.createElement('div', { className: 'ntce-panel-left' },
                      React.createElement('div', { className: 'ntce-title' }, 'NTCE 2025 ', React.createElement('strong', null, 'INTERNATIONAL')),
                      React.createElement('div', { className: 'ntce-lines' },
                        React.createElement('div', { className: 'ntce-line' }, EVENT.dateRange),
                        React.createElement('div', { className: 'ntce-line' }, EVENT.venue)
                      ),
                      React.createElement('div', { className: 'ntce-join' }, 'Join me at ', React.createElement('strong', null, EVENT.hashtag)),
                      React.createElement('div', { className: 'ntce-tagline' }, "Pakistan's Prestigious Construction Industry Event"),
                      React.createElement('button', { className: 'ntce-cta', type: 'button', onClick: (e)=>e.preventDefault() }, 'REGISTER FOR FREE ENTRY TILL 31 OCT')
                    ),
                    React.createElement('div', { className: 'ntce-watermark' },
                      React.createElement('img', { src: './international2025.png', alt: 'International 2025', className: 'ntce-watermark-img' })
                    )
                  ),
                  React.createElement('div', { className: 'ntce-stats' },
                    EVENT.stats.map((s, i) => (
                      React.createElement('div', { key: i, className: 'ntce-stat' },
                        React.createElement('div', { className: 'ntce-stat-value' }, s.value),
                        React.createElement('div', { className: 'ntce-stat-label' }, s.label)
                      )
                    ))
                  )
                )
              )
            )
          )
        )
      );
    }

    const reg = getRegistration();
    const fullName = reg.fullName || reg['fullName'] || '';
    const organization = reg.organization || reg['organization'] || '';
    const avatarUrl = reg.avatarDataUrl || reg.avatarUrl || '';

    const rootEl = document.getElementById('card-root');
    const el = React.createElement(InviteCard, { fullName, organization, avatarUrl });
    if (typeof ReactDOM.createRoot === 'function') {
      const root = ReactDOM.createRoot(rootEl);
      window.__INVITE_ROOT = root;
      root.render(el);
    } else if (typeof ReactDOM.render === 'function') {
      ReactDOM.render(el, rootEl);
    } else {
      console.error('Neither ReactDOM.createRoot nor ReactDOM.render available');
    }

    // Ensure stats/watermark live inside the panel even if stale markup was cached
    function coercePanelChildren() {
      try {
        const card = document.querySelector('#inviteCard .ntce-card');
        const panel = card?.querySelector('.ntce-panel');
        if (!card || !panel) return;
        const wmOutside = card.querySelector(':scope > .ntce-watermark');
        if (wmOutside) panel.appendChild(wmOutside);
        const statsOutside = card.querySelector(':scope > .ntce-stats');
        if (statsOutside) panel.appendChild(statsOutside);
      } catch {}
    }
    coercePanelChildren();

    // Render once as an image for stable layout
    renderCardImage();
    fitCardToWidth();
    trace('renderCardImage-called');

    // Actions
    const downloadBtn = document.getElementById('downloadBtn');
    const shareBtn = document.getElementById('shareBtn');
    const googleCal = document.getElementById('googleCal');

    googleCal.href = googleCalendarUrl(EVENT);

    // Attempt decrypt if we only have a signed URL (local registration)
    (async () => {
      try {
        if (!reg.avatarDataUrl && reg.avatarUrl && reg.avatarKey && reg.avatarIv) {
          const res = await fetch(reg.avatarUrl);
          const enc = await res.arrayBuffer();
          const key = await crypto.subtle.importKey('raw', b64ToBuf(reg.avatarKey), { name: 'AES-GCM' }, false, ['decrypt']);
          const iv = new Uint8Array(b64ToBuf(reg.avatarIv));
          const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc);
          const type = reg.avatarType || 'image/png';
          const blob = new Blob([dec], { type });
          const url = URL.createObjectURL(blob);
          const container = document.querySelector('#inviteCard .avatar');
          if (!container) { URL.revokeObjectURL(url); return; }
          let img = container.querySelector('img');
          if (!img) { img = document.createElement('img'); container.appendChild(img); }
          img.src = url;
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          // Re-render image now that avatar is decrypted
          renderCardImage();
          fitCardToWidth();
        }
      } catch (e) { console.warn('Avatar decrypt failed', e); }
    })();

    // Enrich from DB then re-render if found
    (async () => {
      const enriched = await getRegistrationFromDB(reg);
      if (!enriched) return;
      try {
        const fullName2 = enriched.fullName || fullName;
        const organization2 = enriched.organization || organization;
        const avatarUrl2 = enriched.avatarDataUrl || enriched.avatarUrl || avatarUrl;
        const next = React.createElement(InviteCard, { fullName: fullName2, organization: organization2, avatarUrl: avatarUrl2 });
        if (typeof ReactDOM.createRoot === 'function' && window.__INVITE_ROOT) {
          window.__INVITE_ROOT.render(next);
        } else if (typeof ReactDOM.render === 'function') {
          ReactDOM.render(next, rootEl);
        }
        // Decrypt avatar from DB if needed
        if (!enriched.avatarDataUrl && enriched.avatarUrl && enriched.avatarKey && enriched.avatarIv) {
          try {
            const res = await fetch(enriched.avatarUrl);
            const enc = await res.arrayBuffer();
            const key = await crypto.subtle.importKey('raw', b64ToBuf(enriched.avatarKey), { name: 'AES-GCM' }, false, ['decrypt']);
            const iv = new Uint8Array(b64ToBuf(enriched.avatarIv));
            const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc);
            const type = enriched.avatarType || 'image/png';
            const blob = new Blob([dec], { type });
            const url = URL.createObjectURL(blob);
            const container = document.querySelector('#inviteCard .ntce-avatar');
            if (container) {
              let img = container.querySelector('img');
              if (!img) { img = document.createElement('img'); container.appendChild(img); }
              img.src = url;
              setTimeout(() => URL.revokeObjectURL(url), 30000);
              renderCardImage();
              fitCardToWidth();
            }
          } catch (e) { console.warn('DB avatar decrypt failed', e); }
        }
        renderCardImage();
        fitCardToWidth();
      } catch {}
    })();

    downloadBtn?.addEventListener('click', async () => {
      const node = document.getElementById('inviteCard');
      if (!node) { alert('Card not ready yet. Please wait a moment and try again.'); return; }
      try {
        const imgEl = document.getElementById('cardImage');
        let downloadUrl = '';
        if (imgEl && imgEl.src) {
          downloadUrl = imgEl.src;
        } else {
          const hti = await getHtmlToImage();
          if (!hti || typeof hti.toPng !== 'function') throw new Error('Image library not loaded');
          downloadUrl = await hti.toPng(node, { pixelRatio: 2, cacheBust: true, width: 1200, height: 627 });
        }
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = 'ntce-invitation.png';
        a.click();
      } catch (e) {
        console.error('Export failed', e);
        alert('Could not generate image. Please try again.');
      }
    });

    shareBtn?.addEventListener('click', async () => {
      const node = document.getElementById('inviteCard');

      // Attempt direct image share on mobile immediately using precomputed file
      const reg = getRegistration();
      const fullName = reg.fullName || reg['fullName'] || '';
      const organization = reg.organization || reg['organization'] || '';
      const caption = buildCaption(fullName, organization);
      const uaMobile = navigator.userAgent || '';
      const isMobileEnv = /Android|iPhone|iPad|iPod/i.test(uaMobile);
      trace('share-click', { isMobileEnv, hasShare: !!navigator.share, hasCached: !!CACHED_SHARE_FILE });
      if (isMobileEnv && navigator.share && CACHED_SHARE_FILE) {
        try {
          const supportsFiles = (typeof navigator.canShare === 'function') ? navigator.canShare({ files: [CACHED_SHARE_FILE] }) : true;
          if (supportsFiles) {
            try { await navigator.clipboard.writeText(caption); } catch {}
            await navigator.share({ files: [CACHED_SHARE_FILE], text: caption, title: EVENT.title });
            trace('os-share-cached-file-success');
            return;
          } else {
            try { await navigator.clipboard.writeText(caption); } catch {}
            try { await navigator.share({ files: [CACHED_SHARE_FILE], text: caption, title: EVENT.title }); trace('os-share-cached-file-forced'); return; } catch {}
          }
        } catch {}
      }

      // 1) Prepare an image blob (fallback path or if cached file not ready)
      const hti = await getHtmlToImage();
      if (!hti || typeof hti.toPng !== 'function') { alert('Image library not loaded.'); return; }
      let blob;
      const imgEl = document.getElementById('cardImage');
      if (imgEl && imgEl.src) {
        blob = await dataUrlToBlob(imgEl.src);
      } else if (typeof hti.toBlob === 'function') {
        blob = await hti.toBlob(node, { pixelRatio: 2, cacheBust: true, width: 1200, height: 627 });
      } else {
        const dataUrl = await hti.toPng(node, { pixelRatio: 2, cacheBust: true, width: 1200, height: 627 });
        blob = await dataUrlToBlob(dataUrl);
      }

      if (isMobileEnv && navigator.share) {
        try {
          const file = new File([blob], 'ntce-invitation.png', { type: 'image/png' });
          const supportsFiles = (typeof navigator.canShare === 'function') ? navigator.canShare({ files: [file] }) : true;
          if (supportsFiles) {
            try { await navigator.clipboard.writeText(caption); } catch {}
            try { await navigator.share({ files: [file], text: caption, title: EVENT.title }); } catch (e) { if (e && e.name === 'AbortError') return; throw e; }
            trace('os-share-new-file-success');
            return; // success or user canceled
          } else {
            try { await navigator.clipboard.writeText(caption); } catch {}
            try { await navigator.share({ files: [file], text: caption, title: EVENT.title }); trace('os-share-new-file-forced'); return; } catch (e) { if (e && e.name === 'AbortError') return; }
          }
        } catch {}
      }

      // 2) Upload to public Supabase bucket 'cards'
      let publicImageUrl = '';
      let cardFileName = '';
      try {
        const up = await uploadCardPng(blob);
        publicImageUrl = up.publicUrl;
        cardFileName = up.fileName;
      } catch (e) {
        console.error('Upload card failed', e);
        alert('Could not upload the card image. Please try again.');
        return;
      }

      // 3) Build a share landing page URL (server-rendered OG tags)
      const title = 'NTCE 2025 Invitation';
      const sharePageUrl = shortShareUrl(cardFileName, publicImageUrl, title, caption);

      // 4) Device-adaptive share
      const ua = navigator.userAgent || '';
      const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
      if (isMobile) {
        // Prefer opening the LinkedIn app directly on mobile
        trace('deeplink-to-app');
        tryOpenLinkedInApp(sharePageUrl);
        return;
      }
      try { await navigator.clipboard.writeText(caption); } catch {}
      trace('open-web-share');
      window.open(linkedinShareUrl(sharePageUrl), '_blank');
    });

    // no preview share button; "View more" controls removed

    // Resize handlers
    window.addEventListener('resize', fitCardToWidth);
    window.addEventListener('orientationchange', fitCardToWidth);
  } catch (err) {
    console.error('Render failed, falling back to non-React path', err);
    const reg = getRegistration();
    const fullName = reg.fullName || reg['fullName'] || '';
    const organization = reg.organization || reg['organization'] || '';
    const avatarUrl = reg.avatarUrl || '';
    renderFallback(fullName, organization, avatarUrl);
  }
}

// Non-React fallback renderer (ensures the page still works if CDN blocked)
function renderFallback(fullName, organization, avatarUrl = '') {
  const rootEl = document.getElementById('card-root');
  rootEl.innerHTML = `
    <div id="inviteCard" class="pc-card-wrapper" aria-label="Invitation card">
      <section id="card" class="pc-card">
        <div class="pc-inside">
          <div class="pc-shine"></div>
          <div class="pc-glare"></div>
          <div class="ntce-card">
            <div class="ntce-header">
              <div class="ntce-avatar"><img src="${avatarUrl || PLACEHOLDER_AVATAR}" alt="${fullName || 'Your photo'}" /></div>
              <div class="ntce-user"><div class="ntce-name">${fullName || 'Your Name'}</div><div class="ntce-org">${organization || 'Your Organization'}</div></div>
            </div>
            <div class="ntce-panel">
              <div class="ntce-panel-grid">
                <div class="ntce-panel-left">
                  <div class="ntce-title">NTCE 2025 <strong>INTERNATIONAL</strong></div>
                  <div class="ntce-lines"><div class="ntce-line">${EVENT.dateRange}</div><div class="ntce-line">${EVENT.venue}</div></div>
                  <div class="ntce-join">Join me at <strong>${EVENT.hashtag}</strong></div>
                  <div class="ntce-tagline">Pakistan's Prestigious Construction Industry Event</div>
                  <button class="ntce-cta" type="button">REGISTER FOR FREE ENTRY TILL 31 OCT</button>
                </div>
                <div class="ntce-watermark"><img src="./international2025.png" alt="International 2025" class="ntce-watermark-img" /></div>
              </div>
              <div class="ntce-stats">
                ${EVENT.stats.map(s => `<div class="ntce-stat"><div class="ntce-stat-value">${s.value}</div><div class="ntce-stat-label">${s.label}</div></div>`).join('')}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  // Wire actions (same handlers as React path)
  const downloadBtn = document.getElementById('downloadBtn');
  const shareBtn = document.getElementById('shareBtn');
  const googleCal = document.getElementById('googleCal');
  googleCal.href = googleCalendarUrl(EVENT);

  downloadBtn?.addEventListener('click', async () => {
    const node = document.getElementById('inviteCard');
    if (!node) return;
    const hti = window.htmlToImage;
    if (!hti || typeof hti.toPng !== 'function') {
      alert('Image export library not loaded. Please check your network and try again.');
      return;
    }
    const dataUrl = await hti.toPng(node, { pixelRatio: 3, quality: 1 });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'ntce-invitation.png';
    a.click();
  });

  shareBtn?.addEventListener('click', async () => {
    const node = document.getElementById('inviteCard');
    const hti = window.htmlToImage;
    if (!hti || typeof hti.toPng !== 'function') return;
    const dataUrl = await hti.toPng(node, { pixelRatio: 3, quality: 1 });
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'ntce-invitation.png', { type: 'image/png' });
    const caption = `Join me at ${EVENT.title} ${EVENT.dateRange} — ${EVENT.venue}. ${EVENT.hashtag}`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: caption, title: EVENT.title }); return; } catch {}
    }
    try { await navigator.clipboard.writeText(caption); } catch {}
    const url = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent('https://ntce.pk');
    window.open(url, '_blank');
  });

  // Removed: copy caption and view full-size controls
}

// Optional: enrich registration from database (Supabase) and re-render if found
async function getRegistrationFromDB(local = {}) {
  try {
    const supabase = await getSupabase();
    if (!supabase) return null;
    const params = new URLSearchParams(location.search);
    const rid = local.id || local.rid || params.get('rid');
    const email = local.email || params.get('email');
    let data = null;
    if (rid) {
      const { data: d1 } = await supabase.from('registrations').select('id, full_name, organization, avatar_url, avatar_key, avatar_iv, avatar_type, linkedin_url, member_category').eq('id', rid).maybeSingle();
      if (d1) data = d1;
    }
    if (!data && email) {
      const { data: d2 } = await supabase.from('registrations').select('id, full_name, organization, avatar_url, avatar_key, avatar_iv, avatar_type, linkedin_url, member_category').eq('email', email).maybeSingle();
      if (d2) data = d2;
    }
    if (!data) return null;
    return {
      fullName: data.full_name || data.fullname || data.name || local.fullName,
      organization: data.organization || data.org || local.organization,
      avatarUrl: data.avatar_url || data.avatar || local.avatarUrl,
      avatarKey: data.avatar_key || local.avatarKey,
      avatarIv: data.avatar_iv || local.avatarIv,
      avatarType: data.avatar_type || local.avatarType,
      linkedinUrl: data.linkedin_url || local.linkedinUrl,
      memberCategory: data.member_category || local.memberCategory,
      id: data.id || local.id,
      email: email || local.email
    };
  } catch (e) { console.warn('DB fetch failed', e); return null; }
}

// Ensure React UMD is available, otherwise load it and then call cb
function ensureReact(cb) {
  if (window.React && window.ReactDOM) return cb();
  const r = document.createElement('script');
  r.src = 'https://unpkg.com/react@18/umd/react.production.min.js';
  const rd = document.createElement('script');
  rd.src = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js';
  r.onload = () => document.head.appendChild(rd);
  rd.onload = cb;
  document.head.appendChild(r);
}

ensureReact(render);
