/**
 * Cloudflare Workers Google Drive Storage Service
 * Uses standard Web Fetch API and multipart/related upload.
 * Secrets are read from env (Worker environment bindings).
 */

let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Obtain a valid centralized Google Drive access token using Worker secrets
 */
export async function getAccessToken(env) {
  const now = Date.now();
  if (cachedAccessToken && tokenExpiresAt > now + 60000) {
    return cachedAccessToken;
  }

  const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET;

  if (!refreshToken || !clientId) {
    throw new Error('Google Drive configuration missing (GOOGLE_DRIVE_REFRESH_TOKEN or GOOGLE_DRIVE_CLIENT_ID not set).');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  if (clientSecret) {
    params.append('client_secret', clientSecret);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google Drive token refresh failed (${tokenRes.status}): ${errText}`);
  }

  const tokenData = await tokenRes.json();
  cachedAccessToken = tokenData.access_token;
  const expiresInSec = tokenData.expires_in || 3600;
  tokenExpiresAt = now + (expiresInSec * 1000);
  return cachedAccessToken;
}

/**
 * Upload photo buffer to Google Drive folder using multipart/related upload
 */
export async function uploadPhoto(photoBytes, filename, mimeType, env) {
  const accessToken = await getAccessToken(env);
  const folderId = env.GOOGLE_DRIVE_FOLDER_ID;

  const metadata = {
    name: filename || `guest_${Date.now()}.jpg`,
    mimeType: mimeType || 'image/jpeg'
  };
  if (folderId) {
    metadata.parents = [folderId];
  }

  const boundary = '-------sadaneera_worker_boundary_' + Date.now();
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metaHeader = delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType || 'image/jpeg'}\r\n` +
    'Content-Transfer-Encoding: binary\r\n\r\n';

  const metaBytes = new TextEncoder().encode(metaHeader);
  const closeBytes = new TextEncoder().encode(closeDelimiter);

  // Combine metadata + binary photo + close delimiter
  const totalLength = metaBytes.byteLength + photoBytes.byteLength + closeBytes.byteLength;
  const combined = new Uint8Array(totalLength);
  combined.set(metaBytes, 0);
  combined.set(photoBytes, metaBytes.byteLength);
  combined.set(closeBytes, metaBytes.byteLength + photoBytes.byteLength);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(totalLength)
      },
      body: combined
    }
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Google Drive upload failed (${uploadRes.status}): ${errText}`);
  }

  const uploadData = await uploadRes.json();
  return {
    fileId: uploadData.id,
    webViewLink: uploadData.webViewLink
  };
}

/**
 * Stream/Proxy photo directly from Google Drive to the client
 */
export async function fetchPhotoResponse(fileId, env) {
  const accessToken = await getAccessToken(env);
  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );

  if (!driveRes.ok) {
    return new Response(JSON.stringify({ success: false, message: 'Photo not found on Drive' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const contentType = driveRes.headers.get('content-type') || 'image/jpeg';
  return new Response(driveRes.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=604800, immutable'
    }
  });
}

/**
 * Delete a photo file from Google Drive
 */
export async function deletePhoto(fileId, env) {
  try {
    const accessToken = await getAccessToken(env);
    const delRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );
    return delRes.ok;
  } catch (err) {
    console.error('[DriveService] Failed to delete file:', fileId, err);
    return false;
  }
}
