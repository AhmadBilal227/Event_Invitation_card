'use strict';

const https = require('https');

/**
 * LinkedIn post creation with image
 * Uploads image and creates a post on behalf of the user
 */
exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse cookies
    const cookies = parseCookies(event.headers.cookie || '');
    const accessToken = cookies['li_access_token'];
    const personUrn = cookies['li_person'];

    // Validate authentication
    if (!accessToken || !personUrn) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Not authenticated' })
      };
    }

    // Validate person URN format
    if (!/^urn:li:person:[A-Za-z0-9_-]+$/.test(personUrn)) {
      // Clear invalid cookies
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': [
            'li_access_token=; Path=/; Max-Age=0',
            'li_person=; Path=/; Max-Age=0',
            'li_display=; Path=/; Max-Age=0'
          ]
        },
        body: JSON.stringify({ error: 'Invalid authentication state' })
      };
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { caption, imageB64, mimeType = 'image/png' } = body;

    if (!caption || !imageB64) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing caption or image' })
      };
    }

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageB64, 'base64');

    // Step 1: Register upload
    const uploadData = await registerUpload(accessToken, personUrn);
    if (!uploadData || !uploadData.uploadUrl || !uploadData.asset) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to register upload' })
      };
    }

    // Step 2: Upload image
    const uploadSuccess = await uploadImage(uploadData.uploadUrl, imageBuffer, mimeType);
    if (!uploadSuccess) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to upload image' })
      };
    }

    // Step 3: Create post
    const postData = await createPost(accessToken, personUrn, caption, uploadData.asset);
    if (!postData) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to create post' })
      };
    }

    console.log('Post creation response:', JSON.stringify(postData, null, 2));

    // Extract post ID from the response
    // LinkedIn returns the post ID in the 'id' field or sometimes in headers
    const postId = postData.id || postData.value || 'unknown';
    
    // LinkedIn post URLs use the share URN format
    let postUrl;
    if (postId && postId.includes('urn:li:share:')) {
      // Extract the numeric ID from the URN
      const shareId = postId.split(':').pop();
      postUrl = `https://www.linkedin.com/feed/update/urn:li:share:${shareId}/`;
    } else if (postId && postId.includes('urn:li:ugcPost:')) {
      // For UGC posts, extract the numeric ID
      const ugcId = postId.split(':').pop();
      postUrl = `https://www.linkedin.com/feed/update/urn:li:ugcPost:${ugcId}/`;
    } else {
      // Fallback to a generic format
      postUrl = `https://www.linkedin.com/feed/update/${postId}/`;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, postUrl, postId })
    };

  } catch (error) {
    console.error('Post creation error:', error);
    
    // Handle specific error cases
    if (error.statusCode === 401) {
      // Clear invalid tokens
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': [
            'li_access_token=; Path=/; Max-Age=0',
            'li_person=; Path=/; Max-Age=0',
            'li_display=; Path=/; Max-Age=0'
          ]
        },
        body: JSON.stringify({ error: 'Authentication expired' })
      };
    }

    if (error.statusCode === 429) {
      return {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': error.retryAfter || '60'
        },
        body: JSON.stringify({ error: 'Rate limited. Please try again later.' })
      };
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function registerUpload(accessToken, personUrn) {
  const requestBody = {
    registerUploadRequest: {
      recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
      owner: personUrn,
      serviceRelationships: [{
        relationshipType: "OWNER",
        identifier: "urn:li:userGeneratedContent"
      }]
    }
  };

  return makeLinkedInRequest(
    '/v2/assets?action=registerUpload',
    'POST',
    accessToken,
    requestBody
  ).then(response => {
    if (response && response.value) {
      const upload = response.value.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'];
      return {
        uploadUrl: upload?.uploadUrl,
        asset: response.value.asset
      };
    }
    return null;
  });
}

async function uploadImage(uploadUrl, imageBuffer, mimeType) {
  return new Promise((resolve) => {
    const url = new URL(uploadUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': imageBuffer.length
      }
    };

    const req = https.request(options, (res) => {
      res.on('data', () => {}); // Consume response
      res.on('end', () => {
        resolve(res.statusCode === 201 || res.statusCode === 200);
      });
    });

    req.on('error', (e) => {
      console.error('Upload error:', e);
      resolve(false);
    });

    req.write(imageBuffer);
    req.end();
  });
}

async function createPost(accessToken, personUrn, caption, assetUrn) {
  const requestBody = {
    author: personUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: {
          text: caption
        },
        shareMediaCategory: "IMAGE",
        media: [{
          status: "READY",
          media: assetUrn
        }]
      }
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
    }
  };

  return makeLinkedInRequest(
    '/v2/ugcPosts',
    'POST',
    accessToken,
    requestBody
  );
}

async function makeLinkedInRequest(path, method, accessToken, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.linkedin.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': process.env.LINKEDIN_API_VERSION || '202502',
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve(JSON.parse(data || '{}'));
          } else {
            console.error('LinkedIn API error:', res.statusCode, data);
            const error = new Error(`LinkedIn API error: ${res.statusCode}`);
            error.statusCode = res.statusCode;
            error.retryAfter = res.headers['retry-after'];
            reject(error);
          }
        } catch (e) {
          console.error('Response parse error:', e);
          reject(e);
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
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