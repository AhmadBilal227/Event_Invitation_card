'use strict';

/**
 * LinkedIn authentication status check
 * Returns whether the user is signed in and their display name
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
    // Extract cookies from request
    const cookies = parseCookies(event.headers.cookie || '');
    const accessToken = cookies['li_access_token'];
    const personUrn = cookies['li_person'];
    const displayName = cookies['li_display'];

    // Validate authentication state
    const isSignedIn = !!(
      accessToken && 
      personUrn && 
      /^urn:li:person:[A-Za-z0-9_-]+$/.test(personUrn)
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        signedIn: isSignedIn,
        displayName: isSignedIn ? displayName || null : null
      })
    };
  } catch (error) {
    console.error('Status check error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

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