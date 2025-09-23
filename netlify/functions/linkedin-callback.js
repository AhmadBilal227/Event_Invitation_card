'use strict';

const https = require('https');
const { URL, URLSearchParams } = require('url');

/**
 * LinkedIn OAuth callback handler
 * Exchanges authorization code for access token and stores auth state
 */
exports.handler = async (event) => {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse cookies
    const cookies = parseCookies(event.headers.cookie || '');
    const savedState = cookies['li_oauth_state'];
    const savedNonce = cookies['li_oauth_nonce'];
    const returnUrl = decodeURIComponent(cookies['li_return'] || '/success.html');

    // Parse query parameters
    const params = new URLSearchParams(event.rawQuery || '');
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    // Handle user denial
    if (error) {
      console.log('OAuth denied:', error, params.get('error_description'));
      return redirectWithError(returnUrl, 'oauth_denied');
    }

    // Validate state parameter
    if (!state || !savedState || state !== savedState) {
      console.error('State mismatch');
      return redirectWithError(returnUrl, 'invalid_state');
    }

    if (!code) {
      console.error('No authorization code');
      return redirectWithError(returnUrl, 'no_code');
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens) {
      return redirectWithError(returnUrl, 'token_exchange_failed');
    }

    // Extract person URN
    const personUrn = await extractPersonUrn(tokens.id_token, tokens.access_token);
    if (!personUrn) {
      return redirectWithError(returnUrl, 'identity_extraction_failed');
    }

    // Get display name
    const displayName = await getDisplayName(tokens.access_token, personUrn);

    // Set authentication cookies
    const cookieOptions = [
      `li_access_token=${tokens.access_token}; HttpOnly; Path=/; Max-Age=${60 * 24 * 60 * 60}; SameSite=Lax`,
      `li_person=${personUrn}; HttpOnly; Path=/; Max-Age=${60 * 24 * 60 * 60}; SameSite=Lax`,
      `li_display=${encodeURIComponent(displayName || '')}; Path=/; Max-Age=${60 * 24 * 60 * 60}; SameSite=Lax`
    ];

    // Clear temporary cookies
    const clearCookies = [
      'li_oauth_state=; Path=/; Max-Age=0',
      'li_oauth_nonce=; Path=/; Max-Age=0',
      'li_return=; Path=/; Max-Age=0'
    ];

    // In production, add Secure flag
    if (process.env.NODE_ENV === 'production') {
      cookieOptions.forEach((cookie, i) => {
        cookieOptions[i] = cookie.replace('SameSite=Lax', 'SameSite=Lax; Secure');
      });
    }

    // Redirect back to success page
    return {
      statusCode: 302,
      headers: {
        'Location': returnUrl,
        'Set-Cookie': [...cookieOptions, ...clearCookies],
        'Cache-Control': 'no-store'
      },
      body: ''
    };
  } catch (error) {
    console.error('Callback error:', error);
    return redirectWithError('/success.html', 'internal_error');
  }
};

async function exchangeCodeForTokens(code) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI;

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'www.linkedin.com',
      path: '/oauth/v2/accessToken',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': params.toString().length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const tokens = JSON.parse(data);
            resolve(tokens);
          } else {
            console.error('Token exchange failed:', res.statusCode, data);
            resolve(null);
          }
        } catch (e) {
          console.error('Token parse error:', e);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Token request error:', e);
      resolve(null);
    });

    req.write(params.toString());
    req.end();
  });
}

async function extractPersonUrn(idToken, accessToken) {
  // Try to decode ID token first (OIDC)
  if (idToken) {
    try {
      // Simple JWT decode (without verification for now)
      const payload = idToken.split('.')[1];
      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
      if (decoded.sub) {
        return `urn:li:person:${decoded.sub}`;
      }
    } catch (e) {
      console.warn('ID token decode failed:', e);
    }
  }

  // Fallback to userinfo endpoint
  try {
    const userinfo = await makeLinkedInRequest('/v2/userinfo', accessToken);
    if (userinfo && userinfo.sub) {
      return `urn:li:person:${userinfo.sub}`;
    }
  } catch (e) {
    console.warn('Userinfo request failed:', e);
  }

  // Last resort: v2/me endpoint
  try {
    const profile = await makeLinkedInRequest('/v2/me', accessToken);
    if (profile && profile.id) {
      return `urn:li:person:${profile.id}`;
    }
  } catch (e) {
    console.error('Profile request failed:', e);
  }

  return null;
}

async function getDisplayName(accessToken, personUrn) {
  try {
    // Try to get basic profile info
    const profile = await makeLinkedInRequest('/v2/me?projection=(localizedFirstName,localizedLastName)', accessToken);
    if (profile && profile.localizedFirstName) {
      const firstName = profile.localizedFirstName || '';
      const lastName = profile.localizedLastName || '';
      return `${firstName} ${lastName}`.trim();
    }
  } catch (e) {
    console.warn('Display name fetch failed:', e);
  }
  return null;
}

async function makeLinkedInRequest(path, accessToken) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.linkedin.com',
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': process.env.LINKEDIN_API_VERSION || '202502'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            console.error('LinkedIn API error:', res.statusCode, data);
            resolve(null);
          }
        } catch (e) {
          console.error('Response parse error:', e);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Request error:', e);
      resolve(null);
    });

    req.end();
  });
}

function parseCookies(cookieString) {
  const cookies = {};
  cookieString.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });
  return cookies;
}

function redirectWithError(returnUrl, errorCode) {
  const url = new URL(returnUrl, 'http://localhost');
  url.searchParams.set('linkedin_error', errorCode);
  
  return {
    statusCode: 302,
    headers: {
      'Location': url.pathname + url.search,
      'Cache-Control': 'no-store'
    },
    body: ''
  };
}