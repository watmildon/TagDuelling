// Cloudflare Worker for TURN credential generation and room signaling
// KV Binding: TURN_SECRETS → watmildon-tagduelling
// KV Keys: 'Turn-API-Key', 'Turn-Token-Id'
// Room keys: 'room:<code>' → { offer, answer, created }

// Allowed origins
const ALLOWED_ORIGINS = [
  'https://watmildon.github.io',
];

// Room code characters (no ambiguous chars: 0/O, 1/I/L)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const ROOM_TTL = 600; // 10 minutes in seconds

// Rate limiting: max rooms per origin per minute
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 10; // max room creations per window

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    // Check if origin is allowed
    const isAllowedOrigin = origin && ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed));

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      if (!isAllowedOrigin) {
        return new Response('Forbidden', { status: 403 });
      }
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // Reject requests from disallowed origins
    if (!isAllowedOrigin) {
      return new Response('Forbidden', { status: 403 });
    }

    const url = new URL(request.url);

    // TURN credentials endpoint
    if (url.pathname === '/generate-turn-creds') {
      return handleTurnCredentials(env, origin);
    }

    // Room creation endpoint
    if (url.pathname === '/room/create' && request.method === 'POST') {
      return handleRoomCreate(request, env, origin);
    }

    // Room join endpoint
    if (url.pathname === '/room/join' && request.method === 'POST') {
      return handleRoomJoin(request, env, origin);
    }

    // Room status endpoint (for polling)
    const roomMatch = url.pathname.match(/^\/room\/([A-Z0-9]{6})$/i);
    if (roomMatch && request.method === 'GET') {
      return handleRoomStatus(roomMatch[1], env, origin);
    }

    return jsonResponse({ error: 'Not Found' }, 404, origin);
  }
};

/**
 * Handle TURN credential generation
 */
async function handleTurnCredentials(env, origin) {
  try {
    const apiToken = await env.TURN_SECRETS.get('Turn-API-Key');
    const turnKeyId = await env.TURN_SECRETS.get('Turn-Token-Id');

    if (!apiToken || !turnKeyId) {
      return jsonResponse({ error: 'Server configuration error' }, 500, origin);
    }

    const apiURL = `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate`;

    const response = await fetch(apiURL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ttl: 3600 })
    });

    if (!response.ok) {
      console.error('Cloudflare API error:', response.status);
      return jsonResponse({ error: 'Failed to generate credentials' }, 500, origin);
    }

    const data = await response.json();

    return jsonResponse({
      iceServers: {
        urls: [
          'stun:stun.cloudflare.com:3478',
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:3478?transport=tcp',
          'turns:turn.cloudflare.com:443?transport=tcp'
        ],
        username: data.iceServers.username,
        credential: data.iceServers.credential
      }
    }, 200, origin);

  } catch (err) {
    console.error('Error:', err);
    return jsonResponse({ error: 'Internal error' }, 500, origin);
  }
}

/**
 * Handle room creation
 */
async function handleRoomCreate(request, env, origin) {
  try {
    // Rate limiting check
    const rateLimitKey = `ratelimit:${origin}`;
    const currentCount = parseInt(await env.TURN_SECRETS.get(rateLimitKey) || '0');

    if (currentCount >= RATE_LIMIT_MAX) {
      return jsonResponse({ error: 'Rate limit exceeded. Please wait a minute.' }, 429, origin);
    }

    // Increment rate limit counter
    await env.TURN_SECRETS.put(rateLimitKey, String(currentCount + 1), {
      expirationTtl: RATE_LIMIT_WINDOW
    });

    // Parse request body
    const body = await request.json();
    if (!body.offer) {
      return jsonResponse({ error: 'Missing offer' }, 400, origin);
    }

    // Generate unique room code
    let code;
    let attempts = 0;
    do {
      code = generateRoomCode();
      const existing = await env.TURN_SECRETS.get(`room:${code}`);
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      return jsonResponse({ error: 'Failed to generate room code' }, 500, origin);
    }

    // Store room data
    const roomData = {
      offer: body.offer,
      answer: null,
      created: Date.now()
    };

    await env.TURN_SECRETS.put(`room:${code}`, JSON.stringify(roomData), {
      expirationTtl: ROOM_TTL
    });

    return jsonResponse({ code }, 200, origin);

  } catch (err) {
    console.error('Room create error:', err);
    return jsonResponse({ error: 'Failed to create room' }, 500, origin);
  }
}

/**
 * Handle room join (guest submits answer)
 */
async function handleRoomJoin(request, env, origin) {
  try {
    const body = await request.json();

    if (!body.code || !body.answer) {
      return jsonResponse({ error: 'Missing code or answer' }, 400, origin);
    }

    const code = body.code.toUpperCase();
    const roomKey = `room:${code}`;
    const roomDataStr = await env.TURN_SECRETS.get(roomKey);

    if (!roomDataStr) {
      return jsonResponse({ error: 'Room not found or expired' }, 404, origin);
    }

    const roomData = JSON.parse(roomDataStr);

    if (roomData.answer) {
      return jsonResponse({ error: 'Room already has a player' }, 409, origin);
    }

    // Update room with answer
    roomData.answer = body.answer;

    // Re-store with remaining TTL (approximate)
    const elapsed = Math.floor((Date.now() - roomData.created) / 1000);
    const remainingTtl = Math.max(ROOM_TTL - elapsed, 60); // At least 1 minute

    await env.TURN_SECRETS.put(roomKey, JSON.stringify(roomData), {
      expirationTtl: remainingTtl
    });

    // Return the offer so guest can process it
    return jsonResponse({ offer: roomData.offer }, 200, origin);

  } catch (err) {
    console.error('Room join error:', err);
    return jsonResponse({ error: 'Failed to join room' }, 500, origin);
  }
}

/**
 * Handle room status check (host polling for answer, guest getting offer)
 */
async function handleRoomStatus(code, env, origin) {
  try {
    const roomKey = `room:${code.toUpperCase()}`;
    const roomDataStr = await env.TURN_SECRETS.get(roomKey);

    if (!roomDataStr) {
      return jsonResponse({ error: 'Room not found or expired' }, 404, origin);
    }

    const roomData = JSON.parse(roomDataStr);

    // Return offer (for guest) and answer status (for host polling)
    return jsonResponse({
      offer: roomData.offer,
      hasAnswer: roomData.answer !== null,
      answer: roomData.answer
    }, 200, origin);

  } catch (err) {
    console.error('Room status error:', err);
    return jsonResponse({ error: 'Failed to get room status' }, 500, origin);
  }
}

/**
 * Generate a random room code
 */
function generateRoomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return code;
}

/**
 * Create JSON response with CORS headers
 */
function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin
    }
  });
}
