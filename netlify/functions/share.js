'use strict';

const SUPABASE_PUBLIC_CARDS = 'https://kssqqrunttoblwfopdvj.supabase.co/storage/v1/object/public/cards/';

function escHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

exports.handler = async (event) => {
  const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}${event.rawQuery ? '?' + event.rawQuery : ''}`);
  // Support pretty path /share/:id by mapping to cards bucket
  const idParam = url.searchParams.get('id');
  let img = url.searchParams.get('img') || '';
  if (!img && idParam) {
    // Allow both with and without extension; default to .png
    const id = /\.(png|jpg|jpeg|webp)$/i.test(idParam) ? idParam : `${idParam}.png`;
    img = SUPABASE_PUBLIC_CARDS + encodeURIComponent(id);
  }
  const title = url.searchParams.get('title') || 'NTCE 2025 Invitation';
  const desc = (url.searchParams.get('desc') || 'Join me at NTCE 2025 — University of Central Punjab. #ntce2025').replace(/\s+/g, ' ').trim();

  // Compute a pretty canonical URL using the /s/* path instead of the function path
  const splat = (url.pathname.replace(/^(\/\.netlify\/functions\/share\/)/, '') || '').replace(/^\//, '');
  const canonicalUrl = `${url.origin}/s/${splat}${url.search}`;

  // Basic allowlist for image URL (http/https)
  const isValidImg = /^https?:\/\//i.test(img);
  const imageUrl = isValidImg ? img : '';
  const proxyUrl = imageUrl ? `${url.origin}/.netlify/functions/img?u=${encodeURIComponent(imageUrl)}` : '';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escHtml(title)}</title>
    <meta name="description" content="${escHtml(desc)}" />

    <meta property="og:type" content="article" />
    <meta property="article:published_time" content="${new Date().toISOString()}" />
    <meta property="article:author" content="NTCE" />
    <meta property="og:site_name" content="NTCE" />
    <meta property="og:title" content="${escHtml(title)}" />
    <meta property="og:description" content="${escHtml(desc)}" />
    ${proxyUrl ? `<meta property="og:image" content="${escHtml(proxyUrl)}" />` : ''}
    ${proxyUrl ? `<meta property="og:image:secure_url" content="${escHtml(proxyUrl)}" />` : ''}
    ${imageUrl ? `<meta property="og:image:type" content="image/png" />` : ''}
    ${imageUrl ? `<meta property="og:image:alt" content="Invitation" />` : ''}
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="627" />
    <meta property="og:url" content="${escHtml(canonicalUrl)}" />
    <link rel="canonical" href="${escHtml(canonicalUrl)}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escHtml(title)}" />
    <meta name="twitter:description" content="${escHtml(desc)}" />
    ${proxyUrl ? `<meta name="twitter:image" content="${escHtml(proxyUrl)}" />` : ''}

    <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;padding:24px;line-height:1.5;background:#0b2031;color:#eaf3fb} .box{max-width:860px;margin:0 auto;background:#0e2030;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:20px} .img{margin-top:12px;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.35);max-width:100%}</style>
  </head>
  <body>
    <div class="box">
      <h1>${escHtml(title)}</h1>
      <p>${escHtml(desc)}</p>
      ${imageUrl ? `<img class="img" src="${escHtml(imageUrl)}" alt="Invitation" />` : `<p>No image provided.</p>`}
      <p><small>Tip: If LinkedIn doesn\'t show a preview immediately, it may be using cache. Try posting or refreshing.</small></p>
    </div>
  </body>
</html>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
    body: html,
  };
};
