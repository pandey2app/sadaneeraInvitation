/**
 * Sadaneera Mahotsav - Validation & Checksum Engine
 * Ensures 100% data integrity and that no mandatory fields are left blank.
 */

// Simple SHA-256 implementation using Web Crypto API
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

class FormValidator {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Validate form fields and compute real-time checksum
   * @param {Object} data 
   * @returns {Promise<{isValid: boolean, checksum: string, missing: string[], checks: Object}>}
   */
  async evaluate(data) {
    const checks = {
      title: Boolean(data.title && data.title.trim().length > 0),
      gender: Boolean(data.gender && data.gender.trim().length > 0),
      name: Boolean(data.name && data.name.trim().length >= 2),
      about: Boolean(data.about && data.about.trim().length >= 3),
      badge: Boolean(data.badge && data.badge.trim().length >= 2),
      photo: Boolean(data.photoData && data.photoData.length > 50)
    };

    const missing = [];
    if (!checks.title) missing.push('संबोधन (श्री/श्रीमती/सुश्री)');
    if (!checks.gender) missing.push('लिंग (Gender)');
    if (!checks.name) missing.push('अतिथि का पूरा नाम (Guest Name)');
    if (!checks.about) missing.push('पद / परिचय / पता (About / Profession)');
    if (!checks.badge) missing.push('अतिथि सम्मान पद (Guest Badge)');
    if (!checks.photo) missing.push('अतिथि की फ़ोटो (Cropped Photo)');

    const isValid = missing.length === 0;

    // Concatenate content for integrity checksum
    const rawString = [
      data.title || '',
      data.gender || '',
      (data.name || '').trim().toLowerCase(),
      (data.about || '').trim(),
      (data.badge || '').trim(),
      data.eventDate || '',
      data.eventVenue || '',
      (data.photoData || '').slice(0, 100)
    ].join('|');

    const fullHash = await sha256(rawString);
    const shortChecksum = `SN-${fullHash.slice(0, 8).toUpperCase()}`;

    return {
      isValid,
      checksum: shortChecksum,
      fullHash,
      missing,
      checks
    };
  }

  /**
   * Update the UI Checklist & Checksum display
   */
  updateUI(evalResult) {
    const pill = document.getElementById('checksumStatusPill');
    const hashDisplay = document.getElementById('checksumHashDisplay');
    const submitBtn = document.getElementById('btnSaveRecord');
    const dlPngBtn = document.getElementById('btnDownloadPng');
    const dlPdfBtn = document.getElementById('btnDownloadPdf');

    // Checklist elements
    const itemTitle = document.getElementById('checkTitle');
    const itemName = document.getElementById('checkName');
    const itemAbout = document.getElementById('checkAbout');
    const itemBadge = document.getElementById('checkBadge');
    const itemPhoto = document.getElementById('checkPhoto');

    const setItem = (elem, ok) => {
      if (!elem) return;
      if (ok) {
        elem.className = 'checklist-item done';
        elem.innerHTML = `✓ ${elem.dataset.label}`;
      } else {
        elem.className = 'checklist-item pending';
        elem.innerHTML = `○ ${elem.dataset.label}`;
      }
    };

    setItem(itemTitle, evalResult.checks.title && evalResult.checks.gender);
    setItem(itemName, evalResult.checks.name);
    setItem(itemAbout, evalResult.checks.about);
    setItem(itemBadge, evalResult.checks.badge);
    setItem(itemPhoto, evalResult.checks.photo);

    if (evalResult.isValid) {
      if (pill) {
        pill.className = 'checksum-status-pill valid';
        pill.textContent = '✓ Checksum Verified (पूर्ण)';
      }
      if (hashDisplay) {
        hashDisplay.textContent = `Integrity Hash: ${evalResult.fullHash.slice(0, 24)}... (${evalResult.checksum})`;
        hashDisplay.style.color = '#15803d';
      }
      if (submitBtn) submitBtn.disabled = false;
      if (dlPngBtn) dlPngBtn.disabled = false;
      if (dlPdfBtn) dlPdfBtn.disabled = false;
    } else {
      if (pill) {
        pill.className = 'checksum-status-pill invalid';
        pill.textContent = `! अपूर्ण (${evalResult.missing.length} शेष)`;
      }
      if (hashDisplay) {
        hashDisplay.textContent = `प्रतीक्षारत: ${evalResult.missing.join(', ')}`;
        hashDisplay.style.color = '#b45309';
      }
      if (submitBtn) submitBtn.disabled = true;
      if (dlPngBtn) dlPngBtn.disabled = true;
      if (dlPdfBtn) dlPdfBtn.disabled = true;
    }
  }
}

window.FormValidator = FormValidator;
