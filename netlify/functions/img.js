'use strict';

const ALLOW_HOSTS = new Set([
  'kssqqrunttoblwfopdvj.supabase.co',
]);

exports.handler = async (event) => {
  try {
    const u = (event.queryStringParameters && event.queryStringParameters.u) || '';
    if (!/^https?:\/\//i.test(u)) {
      return { statusCode: 400, body: 'Missing or invalid URL' };
    }
    const target = new URL(u);
    if (!ALLOW_HOSTS.has(target.hostname)) {
      return { statusCode: 403, body: 'Host not allowed' };
    }

    const resp = await fetch(target.toString(), { redirect: 'follow' });
    if (!resp.ok) {
      return { statusCode: 502, body: `Upstream error: ${resp.status}` };
    }
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    if (!/^image\//i.test(contentType)) {
      return { statusCode: 415, body: 'Unsupported media type' };
    }
    const ab = await resp.arrayBuffer();
    const buff = Buffer.from(ab);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800, immutable',
        'Content-Disposition': 'inline',
      },
      body: buff.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, body: 'Proxy error' };
  }
};
