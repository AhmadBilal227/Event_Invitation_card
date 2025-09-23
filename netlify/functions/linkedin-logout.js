'use strict';

/**
 * LinkedIn logout handler
 * Clears authentication cookies and redirects back
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
    // Get return URL from query params
    const params = new URLSearchParams(event.rawQuery || '');
    const returnUrl = params.get('return') || '/success.html';

    // Clear all LinkedIn-related cookies
    const clearCookies = [
      'li_access_token=; Path=/; Max-Age=0',
      'li_person=; Path=/; Max-Age=0',
      'li_display=; Path=/; Max-Age=0',
      'li_oauth_state=; Path=/; Max-Age=0',
      'li_oauth_nonce=; Path=/; Max-Age=0',
      'li_return=; Path=/; Max-Age=0'
    ];

    // Redirect back with cleared cookies
    return {
      statusCode: 302,
      headers: {
        'Location': returnUrl,
        'Set-Cookie': clearCookies,
        'Cache-Control': 'no-store'
      },
      body: ''
    };
  } catch (error) {
    console.error('Logout error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};