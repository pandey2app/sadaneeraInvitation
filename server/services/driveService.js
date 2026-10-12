/**
 * Centralized Server-Side Google Drive Storage Service for Sadaneera Mahotsav 2026
 * 
 * Architecture:
 * - One centralized server-side authorization associated with the designated account (pandey2app@gmail.com).
 * - Normal Admins never connect their personal Google Drive accounts.
 * - Photos uploaded by ANY Admin automatically store in the dedicated Google Drive folder:
 *   "Sadaneera Mahotsav 2026 Photos" (configurable via GOOGLE_DRIVE_FOLDER_ID).
 * - Multi-part JPEG streaming to Google Drive without container disk writes.
 * - Permanent deletion safely removes the corresponding Drive photo file.
 * - Never silently falls back to large base64 strings in Firestore for new cards.
 */

const fs = require('fs');
const path = require('path');

let cachedAccessToken = null;
let tokenExpiresAt = 0;
let cachedFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

// Load client ID from firebase config as default fallback if not in env
let defaultClientId = null;
try {
  const cfgPath = path.join(__dirname, '..', '..', 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    defaultClientId = cfg.oAuthClientId || null;
  }
} catch (_) {}

/**
 * Obtain a valid centralized Google Drive access token using server credentials.
 */
async function getCentralizedAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && tokenExpiresAt > now + 60000) {
    return cachedAccessToken;
  }

  // 1. Direct environment access token (if provided in deployment environment)
  if (process.env.GOOGLE_DRIVE_ACCESS_TOKEN) {
    cachedAccessToken = process.env.GOOGLE_DRIVE_ACCESS_TOKEN.trim();
    tokenExpiresAt = now + 3600000;
    return cachedAccessToken;
  }

  // 2. Refresh token flow (Primary centralized mechanism)
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || defaultClientId;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

  if (refreshToken && clientId) {
    try {
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

      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        cachedAccessToken = tokenData.access_token;
        const expiresInSec = tokenData.expires_in || 3600;
        tokenExpiresAt = now + (expiresInSec * 1000);
        console.log('[DriveService] Centralized Google Drive access token refreshed successfully.');
        return cachedAccessToken;
      } else {
        const errText = await tokenRes.text();
        console.error('[DriveService] Refresh token request failed:', tokenRes.status, errText);
      }
    } catch (err) {
      console.error('[DriveService] Error refreshing centralized token:', err.message);
    }
  }

  // 3. Fallback: Check if an access token was initialized in server state
  if (cachedAccessToken) {
    return cachedAccessToken;
  }

  throw new Error('Centralized Google Drive authorization is not configured or token expired. Please configure GOOGLE_DRIVE_REFRESH_TOKEN in server environment.');
}

/**
 * Locate or create the centralized 'Sadaneera Mahotsav 2026 Photos' Google Drive folder.
 */
async function getCentralizedFolderId(token) {
  if (process.env.GOOGLE_DRIVE_FOLDER_ID && process.env.GOOGLE_DRIVE_FOLDER_ID.trim()) {
    return process.env.GOOGLE_DRIVE_FOLDER_ID.trim();
  }

  if (cachedFolderId) {
    return cachedFolderId;
  }

  const folderName = 'Sadaneera Mahotsav 2026 Photos';

  try {
    const query = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.files && data.files.length > 0) {
        cachedFolderId = data.files[0].id;
        console.log(`[DriveService] Using existing centralized Drive folder: ${cachedFolderId}`);
        return cachedFolderId;
      }
    }

    // Create the folder once if not found
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });

    if (createRes.ok) {
      const folderData = await createRes.json();
      cachedFolderId = folderData.id;
      console.log(`[DriveService] Created centralized Drive folder: ${cachedFolderId}`);

      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${cachedFolderId}/permissions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ role: 'reader', type: 'anyone' })
        });
      } catch (e) {
        console.warn('[DriveService] Folder permission notice:', e.message);
      }

      return cachedFolderId;
    }
  } catch (err) {
    console.error('[DriveService] Error finding/creating folder:', err.message);
  }

  return null;
}

/**
 * Upload an image buffer directly to the centralized Google Drive account and folder.
 */
async function uploadPhoto({ buffer, filename }) {
  const token = await getCentralizedAccessToken();

  let folderId = null;
  try {
    folderId = await getCentralizedFolderId(token);
  } catch (err) {
    console.warn('[DriveService] Folder lookup notice:', err.message);
  }

  const boundary = `-------SadaneeraDrive${Date.now()}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: filename || `guest_${Date.now()}.jpg`,
    mimeType: 'image/jpeg'
  };

  if (folderId) {
    metadata.parents = [folderId];
  }

  const multipartBody = Buffer.concat([
    Buffer.from(delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata)),
    Buffer.from(delimiter + 'Content-Type: image/jpeg\r\n\r\n'),
    buffer,
    Buffer.from(closeDelimiter)
  ]);

  const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webContentLink,webViewLink';
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(multipartBody.length)
    },
    body: multipartBody
  });

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    console.error('[DriveService] Drive upload failed:', uploadRes.status, errorText);
    throw new Error(`Google Drive API upload failed (${uploadRes.status}): ${errorText.slice(0, 200)}`);
  }

  const fileData = await uploadRes.json();
  const fileId = fileData.id;
  console.log(`[DriveService] File uploaded successfully to Google Drive. File ID: ${fileId}`);

  // Set file permission to anyone with link as reader
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone'
      })
    });
  } catch (permErr) {
    console.warn('[DriveService] Warning setting file permission:', permErr.message);
  }

  const directCdnUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
  const proxyUrl = `/api/cards/photo/drive/${fileId}`;

  return {
    fileId,
    name: fileData.name,
    directCdnUrl,
    proxyUrl,
    webContentLink: fileData.webContentLink || directCdnUrl
  };
}

/**
 * Permanently delete a photo from Google Drive.
 * Deletes ONLY the specific file explicitly associated with the invitation.
 */
async function deletePhoto(fileId) {
  if (!fileId || typeof fileId !== 'string') return false;
  const cleanId = fileId.trim();
  if (!cleanId) return false;

  let token = null;
  try {
    token = await getCentralizedAccessToken();
  } catch (err) {
    console.warn(`[DriveService] No token available to delete file: ${cleanId} (${err.message})`);
    throw err;
  }

  const deleteUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}`;
  const delRes = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (delRes.status === 204 || delRes.status === 200) {
    console.log(`[DriveService] Successfully deleted file from Google Drive: ${cleanId}`);
    return true;
  }

  if (delRes.status === 404) {
    console.log(`[DriveService] File already deleted or not found in Google Drive: ${cleanId}`);
    return true; // Already deleted
  }

  const errorText = await delRes.text().catch(() => '');
  console.error(`[DriveService] Failed to delete file ${cleanId} from Google Drive:`, delRes.status, errorText);
  throw new Error(`Google Drive API deletion failed (${delRes.status}): ${errorText.slice(0, 150)}`);
}

/**
 * Fetch photo bytes from Google Drive for server proxy delivery.
 */
async function fetchPhotoBuffer(fileId) {
  // Attempt 1: Direct Google CDN (Fastest, pre-cached, zero auth required once shared)
  try {
    const cdnRes = await fetch(`https://lh3.googleusercontent.com/d/${fileId}`);
    if (cdnRes.ok) {
      const type = cdnRes.headers.get('content-type') || '';
      if (type.includes('image')) {
        const arrayBuf = await cdnRes.arrayBuffer();
        return {
          buffer: Buffer.from(arrayBuf),
          contentType: type || 'image/jpeg'
        };
      }
    }
  } catch (_) {}

  // Attempt 2: Drive API download with centralized token
  try {
    const token = await getCentralizedAccessToken();
    const apiRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (apiRes.ok) {
      const type = apiRes.headers.get('content-type') || 'image/jpeg';
      const arrayBuf = await apiRes.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuf),
        contentType: type.includes('image') ? type : 'image/jpeg'
      };
    }
  } catch (_) {}

  // Attempt 3: Drive uc?export=view fallback
  try {
    const ucRes = await fetch(`https://drive.google.com/uc?export=view&id=${fileId}`);
    if (ucRes.ok) {
      const type = ucRes.headers.get('content-type') || '';
      if (type.includes('image')) {
        const arrayBuf = await ucRes.arrayBuffer();
        return {
          buffer: Buffer.from(arrayBuf),
          contentType: type || 'image/jpeg'
        };
      }
    }
  } catch (_) {}

  return null;
}

// Allow explicit server setting of token if needed by server admin initialization
function setServerToken(token) {
  if (token && typeof token === 'string' && token.trim()) {
    cachedAccessToken = token.trim();
    tokenExpiresAt = Date.now() + 3600000;
  }
}

module.exports = {
  getCentralizedAccessToken,
  getCentralizedFolderId,
  uploadPhoto,
  deletePhoto,
  fetchPhotoBuffer,
  setServerToken
};
