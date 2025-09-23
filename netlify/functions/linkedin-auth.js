'use strict';

const crypto = require('crypto');

/**
 * LinkedIn OAuth flow initialization
 * Redirects user to LinkedIn for authorization
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
    // Get environment variables
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI;
    const scopes = process.env.LINKEDIN_SCOPES || 'openid profile w_member_social email';

    if (!clientId || !redirectUri) {
      console.error('Missing LinkedIn configuration');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'LinkedIn configuration error' })
      };
    }

    // Generate secure state and nonce
    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');

    // Get return URL from query params
    const params = new URLSearchParams(event.rawQuery || '');
    const returnUrl = params.get('return') || '/success.html';

    // Set cookies for state validation
    const cookieOptions = [
      `li_oauth_state=${state}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`,
      `li_oauth_nonce=${nonce}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`,
      `li_return=${encodeURIComponent(returnUrl)}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`
    ];

    // In production, add Secure flag
    if (process.env.NODE_ENV === 'production') {
      cookieOptions.forEach((cookie, i) => {
        cookieOptions[i] = cookie.replace('SameSite=Lax', 'SameSite=Lax; Secure');
      });
    }

    // Build LinkedIn authorization URL
    const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('nonce', nonce);

    // Redirect to LinkedIn
    return {
      statusCode: 302,
      headers: {
        'Location': authUrl.toString(),
        'Set-Cookie': cookieOptions,
        'Cache-Control': 'no-store'
      },
      body: ''
    };
  } catch (error) {
    console.error('Auth initialization error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};