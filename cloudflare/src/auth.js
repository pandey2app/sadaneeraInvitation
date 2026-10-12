/**
 * Cloudflare Workers Authentication & JWT Service
 * Uses Web Crypto HMAC-SHA256 for fast, zero-dependency JWT handling
 * and bcryptjs for secure password hashing and verification.
 */

import bcrypt from 'bcryptjs';

// Base64URL encoding/decoding for Web Crypto JWT
function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function getCryptoKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Sign a JWT token using Web Crypto HMAC-SHA256
 */
export async function generateToken(user, env) {
  const secret = env.JWT_SECRET || 'sadaneera-mahotsav-secret-token-key-2026';
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    iat: now,
    exp: now + (7 * 24 * 60 * 60) // 7 days
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);

  const key = await getCryptoKey(secret);
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, data);

  let binary = '';
  const bytes = new Uint8Array(signatureBuffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const encodedSignature = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Verify and decode a JWT token using Web Crypto HMAC-SHA256
 */
export async function verifyToken(token, env) {
  const secrets = [
    env.JWT_SECRET,
    'aditya@sadaneera',
    'sadaneera-mahotsav-secret-token-key-2026'
  ].filter(Boolean);

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  // Decode signature
  let sigBinary;
  try {
    let s = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    sigBinary = atob(s);
  } catch {
    return null;
  }
  const signatureBytes = new Uint8Array(sigBinary.length);
  for (let i = 0; i < sigBinary.length; i++) {
    signatureBytes[i] = sigBinary.charCodeAt(i);
  }

  // Verify against known secrets
  for (const secret of secrets) {
    try {
      const key = await getCryptoKey(secret);
      const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, data);
      if (isValid) {
        const payload = JSON.parse(base64UrlDecode(payloadB64));
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) {
          return null; // Expired
        }
        return payload;
      }
    } catch {
      // Try next secret
    }
  }
  return null;
}

/**
 * Middleware: Authenticate requests using Authorization header and D1 database
 */
export async function authenticateRequest(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Authentication required. Please log in.', status: 401 };
  }

  const token = authHeader.substring(7).trim();
  const decoded = await verifyToken(token, env);
  if (!decoded || !decoded.id) {
    return { error: 'Session expired or invalid token. Please log in again.', status: 401 };
  }

  const user = await env.DB.prepare(
    'SELECT id, username, full_name, email, role, is_active FROM users WHERE id = ?'
  ).bind(decoded.id).first();

  if (!user || user.is_active !== 1) {
    return { error: 'User account is deactivated or no longer exists.', status: 403 };
  }

  return { user };
}

/**
 * Hash password using bcryptjs
 */
export function hashPassword(plainPassword) {
  return bcrypt.hashSync(plainPassword, 10);
}

/**
 * Compare password with hash
 */
export function comparePassword(plainPassword, hash) {
  return bcrypt.compareSync(plainPassword, hash);
}

/**
 * Ensure Super Admin exists in D1 database
 */
export async function ensureSuperAdmin(env) {
  const username = (env.SUPERADMIN_USERNAME || 'superadmin').toLowerCase().trim();
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE LOWER(username) = ?'
  ).bind(username).first();

  if (!existing) {
    const password = env.SUPERADMIN_PASSWORD;
    if (!password) {
      // Never use a hardcoded production password; only provision when secret is set via Wrangler
      return;
    }
    const fullName = env.SUPERADMIN_NAME || 'मुख्य प्रशासक (Super Admin)';
    const email = env.SUPERADMIN_EMAIL || 'pandey2app@gmail.com';
    const hash = hashPassword(password);

    await env.DB.prepare(
      'INSERT INTO users (username, password_hash, full_name, email, role, is_active) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(username, hash, fullName, email, 'superadmin', 1).run();
  }
}
