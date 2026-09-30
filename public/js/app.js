/**
 * Sadaneera Mahotsav - Main Application Logic (Portrait Edition)
 * Integrates Module 1 (Generator + Cropper + Checksum + Editable Vishisht Atithi + Portrait Themes), 
 * Module 2 (Super Admin / Admin RBAC + Master Card Content Settings), 
 * and Module 3 (Smart Record Regeneration on the fly).
 */

document.addEventListener('DOMContentLoaded', () => {
  // App State
  const state = {
    user: API.getCurrentUser(),
    activeTab: 'generator',
    masterSettings: null,
    form: {
      gender: 'male',
      title: 'श्री',
      name: '',
      about: '',
      badge: 'विशिष्ट अतिथि',
      theme: 'royal-gold',
      eventDate: '15-17 नवंबर 2026',
      eventTime: 'सायं 5:00 बजे से',
      eventVenue: 'मुख्य सांस्कृतिक प्रेक्षागृह, सदानीरा परिसर',
      photoData: '',
      checksum: '',
      cardCode: 'SN-0001-XXXX'
    },
    // Scale for live preview (tuned for 720x1040 portrait card)
    previewScale: 0.58,
    recordsFilter: {
      search: '',
      theme: '',
      limit: 50,
      offset: 0
    }
  };

  // Default avatar SVG placeholder for preview before upload
  const DEFAULT_AVATAR = '/assets/avatar-placeholder.svg';
  state.form.photoData = DEFAULT_AVATAR;

  // Initialize Validator & Cropper
  const validator = new FormValidator();
  const cropperModal = new CropperManager({
    onCropComplete: (base64) => {
      state.form.photoData = base64;
      document.getElementById('photoThumbnail').src = base64;
      document.getElementById('photoUploadPlaceholder').style.display = 'none';
      document.getElementById('photoPreviewWrap').style.display = 'flex';
      validateAndUpdate();
      showToast('फ़ोटो क्रॉपिंग पूर्ण हुई (Photo cropped successfully)', 'success');
    }
  });

  // UI Element References
  const authDialog = document.getElementById('authDialog');
  const regenerateModal = document.getElementById('regenerateModal');
  const toastContainer = document.getElementById('toastContainer');

  // ==========================================================================
  // Helper: Toast Notifications
  // ==========================================================================
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span>${icon}</span><div>${message}</div>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
  window.showToast = showToast;

  // ==========================================================================
  // Master Card Content Settings (Super Admin Controlled)
  // ==========================================================================
  async function loadMasterSettings() {
    try {
      const res = await API.getCardContentSettings();
      if (res.success && res.settings) {
        state.masterSettings = res.settings;
        syncMasterSettingsToUI();
        renderLivePreview();
      }
    } catch (err) {
      console.warn('Could not load master settings:', err.message);
    }
  }

  function syncMasterSettingsToUI() {
    if (!state.masterSettings) return;
    const s = state.masterSettings;

    // Sync master settings form fields
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && val) el.value = val;
    };

    setVal('settingsProgramName', s.program_name);
    setVal('settingsInvocation', s.invocation);
    setVal('settingsProgramSubtitle', s.program_subtitle);
    setVal('settingsInvitationMessage', s.invitation_message);
    setVal('settingsEventDate', s.event_date);
    setVal('settingsEventTime', s.event_time);
    setVal('settingsEventVenue', s.event_venue);
    setVal('settingsOrganizerName', s.organizer_name);

    // Sync default generator event inputs if user hasn't modified them
    if (!state.form.eventDate || state.form.eventDate === '15-17 नवंबर 2026') {
      state.form.eventDate = s.event_date;
      setVal('inputEventDate', s.event_date);
    }
    if (!state.form.eventTime || state.form.eventTime === 'सायं 5:00 बजे से') {
      state.form.eventTime = s.event_time;
      setVal('inputEventTime', s.event_time);
    }
    if (!state.form.eventVenue || state.form.eventVenue === 'मुख्य सांस्कृतिक प्रेक्षागृह, सदानीरा परिसर') {
      state.form.eventVenue = s.event_venue;
      setVal('inputEventVenue', s.event_venue);
    }
  }

  // Master Settings Form Submit Handler (Super Admin Only)
  document.getElementById('masterSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnSaveMasterSettings');
    btn.disabled = true;
    btn.textContent = 'सहेजा जा रहा है...';

    try {
      const payload = {
        program_name: document.getElementById('settingsProgramName').value,
        invocation: document.getElementById('settingsInvocation').value,
        program_subtitle: document.getElementById('settingsProgramSubtitle').value,
        invitation_message: document.getElementById('settingsInvitationMessage').value,
        event_date: document.getElementById('settingsEventDate').value,
        event_time: document.getElementById('settingsEventTime').value,
        event_venue: document.getElementById('settingsEventVenue').value,
        organizer_name: document.getElementById('settingsOrganizerName').value
      };

      const res = await API.updateCardContentSettings(payload);
      state.masterSettings = res.settings;
      syncMasterSettingsToUI();
      renderLivePreview();
      showToast('मुख्य कार्ड सामग्री सफलतापूर्वक अपडेट की गई! सभी नए निमंत्रण पत्रों पर यह लागू होगी।', 'success');
    } catch (err) {
      showToast(err.message || 'सामग्री सहेजने में विफल', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 मुख्य कार्ड सामग्री सहेजें (Save Master Settings)';
    }
  });

  document.getElementById('btnPreviewMasterSettings')?.addEventListener('click', () => {
    switchTab('generator');
    showToast('कार्ड जेनरेटर में मुख्य सामग्री का पूर्वावलोकन देखें', 'info');
  });

  // ==========================================================================
  // Auth & Session Management
  // ==========================================================================
  function checkAuth() {
    state.user = API.getCurrentUser();
    if (!state.user || !API.getToken()) {
      authDialog.showModal();
    } else {
      authDialog.close();
      updateHeaderUserUI();
      loadMasterSettings();
      switchTab(state.activeTab);
    }
  }

  function updateHeaderUserUI() {
    if (!state.user) return;
    document.getElementById('currentUserName').textContent = state.user.full_name;
    const roleTag = document.getElementById('currentUserRole');
    roleTag.textContent = state.user.role === 'superadmin' ? 'Super Admin' : 'Admin';
    roleTag.className = `role-tag ${state.user.role}`;

    // Super Admin Only Tabs: Admin Management & Master Settings
    const isSuper = state.user.role === 'superadmin';
    const adminNavBtn = document.getElementById('navBtnAdmins');
    const settingsNavBtn = document.getElementById('navBtnSettings');

    if (adminNavBtn) adminNavBtn.style.display = isSuper ? 'inline-flex' : 'none';
    if (settingsNavBtn) settingsNavBtn.style.display = isSuper ? 'inline-flex' : 'none';

    if (!isSuper && (state.activeTab === 'admins' || state.activeTab === 'settings')) {
      switchTab('generator');
    }
  }

  // Auth Dialog Form Handler
  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'प्रमाणित किया जा रहा है...';

    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    try {
      const res = await API.login(username, password);
      showToast(`स्वागत है, ${res.user.full_name}!`, 'success');
      authDialog.close();
      state.user = res.user;
      updateHeaderUserUI();
      loadMasterSettings();
      switchTab('generator');
    } catch (err) {
      showToast(err.message || 'लॉगिन विफल (Invalid credentials)', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'लॉगिन करें (Sign In)';
    }
  });

  // Logout Handler
  document.getElementById('btnLogout')?.addEventListener('click', () => {
    API.clearSession();
    state.user = null;
    showToast('सत्र समाप्त किया गया (Logged out)', 'info');
    checkAuth();
  });

  window.addEventListener('auth:expired', () => {
    showToast('आपका सत्र समाप्त हो चुका है। कृपया पुनः लॉगिन करें।', 'error');
    API.clearSession();
    checkAuth();
  });

  // ==========================================================================
  // Navigation Tabs Switching
  // ==========================================================================
  function switchTab(tabId) {
    if ((tabId === 'admins' || tabId === 'settings') && state.user?.role !== 'superadmin') {
      showToast('केवल मुख्य प्रशासक (Super Admin) को यह अनुमति है।', 'error');
      tabId = 'generator';
    }

    state.activeTab = tabId;

    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-content').forEach(section => {
      section.classList.toggle('active', section.id === `tab-${tabId}`);
    });

    // Refresh content for the active tab
    if (tabId === 'dashboard') loadDashboard();
    if (tabId === 'records') loadRecords();
    if (tabId === 'admins') loadAdminsList();
    if (tabId === 'settings') syncMasterSettingsToUI();
    if (tabId === 'generator') {
      applyPreviewScale();
      renderLivePreview();
    }
  }

  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ==========================================================================
  // Module 1: Form Inputs & Gender / Salutation Selector
  // ==========================================================================

  // Gender Option Buttons
  document.querySelectorAll('.gender-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedGender = btn.dataset.gender;
      setGenderAndTitle(selectedGender);
    });
  });

  // Title Pill Buttons
  document.querySelectorAll('.title-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const selectedTitle = pill.dataset.title;
      setTitleDirectly(selectedTitle);
    });
  });

  function setGenderAndTitle(gender) {
    state.form.gender = gender;

    document.querySelectorAll('.gender-option-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.gender === gender);
    });

    // Auto set appropriate Hindi honorific title based on gender requirement:
    // Shri for male, Smt for married female, Sushri for unmarried female
    if (gender === 'male') {
      state.form.title = 'श्री';
    } else if (gender === 'female_married') {
      state.form.title = 'श्रीमती';
    } else if (gender === 'female_unmarried') {
      state.form.title = 'सुश्री';
    }

    // Sync title pills
    document.querySelectorAll('.title-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.title === state.form.title);
    });

    validateAndUpdate();
  }

  function setTitleDirectly(title) {
    state.form.title = title;

    document.querySelectorAll('.title-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.title === title);
    });

    // Align gender selection accordingly
    if (title === 'श्री') state.form.gender = 'male';
    else if (title === 'श्रीमती') state.form.gender = 'female_married';
    else if (title === 'सुश्री') state.form.gender = 'female_unmarried';

    document.querySelectorAll('.gender-option-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.gender === state.form.gender);
    });

    validateAndUpdate();
  }

  // Inputs: Name, About, Editable Badge, Theme
  const inputGuestName = document.getElementById('inputGuestName');
  const inputGuestAbout = document.getElementById('inputGuestAbout');
  const inputGuestBadge = document.getElementById('inputGuestBadge');
  const selectTheme = document.getElementById('selectTheme');
  const inputEventDate = document.getElementById('inputEventDate');
  const inputEventTime = document.getElementById('inputEventTime');
  const inputEventVenue = document.getElementById('inputEventVenue');

  inputGuestName?.addEventListener('input', (e) => {
    state.form.name = e.target.value;
    validateAndUpdate();
  });

  inputGuestAbout?.addEventListener('input', (e) => {
    state.form.about = e.target.value;
    validateAndUpdate();
  });

  inputGuestBadge?.addEventListener('input', (e) => {
    state.form.badge = e.target.value;
    validateAndUpdate();
  });

  // Preset buttons for editable Vishisht Atithi badge
  document.querySelectorAll('.badge-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const badge = btn.dataset.badge;
      state.form.badge = badge;
      if (inputGuestBadge) inputGuestBadge.value = badge;
      validateAndUpdate();
    });
  });

  selectTheme?.addEventListener('change', (e) => {
    state.form.theme = e.target.value;
    renderLivePreview();
  });

  inputEventDate?.addEventListener('input', (e) => {
    state.form.eventDate = e.target.value;
    renderLivePreview();
  });

  inputEventTime?.addEventListener('input', (e) => {
    state.form.eventTime = e.target.value;
    renderLivePreview();
  });

  inputEventVenue?.addEventListener('input', (e) => {
    state.form.eventVenue = e.target.value;
    renderLivePreview();
  });

  // Photo Upload & Drop Zone
  const photoDropZone = document.getElementById('photoDropZone');
  const photoFileInput = document.getElementById('photoFileInput');

  photoDropZone?.addEventListener('click', (e) => {
    if (e.target.id === 'btnRecropPhoto' || e.target.id === 'btnRemovePhoto') return;
    photoFileInput.click();
  });

  photoFileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      cropperModal.loadImage(e.target.files[0]);
    }
  });

  photoDropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    photoDropZone.style.borderColor = 'var(--primary)';
  });

  photoDropZone?.addEventListener('dragleave', () => {
    photoDropZone.style.borderColor = '#d1c7b7';
  });

  photoDropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    photoDropZone.style.borderColor = '#d1c7b7';
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      cropperModal.loadImage(e.dataTransfer.files[0]);
    }
  });

  document.getElementById('btnRecropPhoto')?.addEventListener('click', () => {
    if (state.form.photoData && state.form.photoData !== DEFAULT_AVATAR) {
      cropperModal.loadImage(state.form.photoData);
    } else {
      photoFileInput.click();
    }
  });

  document.getElementById('btnRemovePhoto')?.addEventListener('click', () => {
    state.form.photoData = DEFAULT_AVATAR;
    document.getElementById('photoPreviewWrap').style.display = 'none';
    document.getElementById('photoUploadPlaceholder').style.display = 'block';
    photoFileInput.value = '';
    validateAndUpdate();
  });

  // Scale Controls for Portrait Preview (720px wide x 1040px tall)
  function applyPreviewScale() {
    const scaler = document.getElementById('liveCardScaler');
    if (scaler) {
      scaler.style.transform = `scale(${state.previewScale})`;
      const originHeight = 1040; // portrait card natural height
      const scaledHeight = originHeight * state.previewScale;
      scaler.style.height = `${originHeight}px`;
      scaler.style.marginBottom = `${-(originHeight - scaledHeight)}px`;
    }
    const indicator = document.getElementById('scaleIndicator');
    if (indicator) indicator.textContent = `${Math.round(state.previewScale * 100)}%`;
  }

  document.getElementById('btnZoomInPreview')?.addEventListener('click', () => {
    if (state.previewScale < 1.0) {
      state.previewScale = Math.min(1.0, state.previewScale + 0.06);
      applyPreviewScale();
    }
  });

  document.getElementById('btnZoomOutPreview')?.addEventListener('click', () => {
    if (state.previewScale > 0.35) {
      state.previewScale = Math.max(0.35, state.previewScale - 0.06);
      applyPreviewScale();
    }
  });

  document.getElementById('btnFitPreview')?.addEventListener('click', () => {
    const viewport = document.getElementById('previewViewport');
    if (viewport) {
      const availWidth = viewport.clientWidth - 48;
      const fitScale = Math.min(0.85, Math.max(0.35, availWidth / 720));
      state.previewScale = fitScale;
      applyPreviewScale();
    }
  });

  // Validation & Live Preview Re-rendering
  async function validateAndUpdate() {
    const evalResult = await validator.evaluate({
      title: state.form.title,
      gender: state.form.gender,
      name: state.form.name,
      about: state.form.about,
      badge: state.form.badge,
      eventDate: state.form.eventDate,
      eventVenue: state.form.eventVenue,
      photoData: state.form.photoData !== DEFAULT_AVATAR ? state.form.photoData : ''
    });

    state.form.checksum = evalResult.checksum;
    validator.updateUI(evalResult);
    renderLivePreview();
  }

  function renderLivePreview() {
    const container = document.getElementById('liveCardContainer');
    if (!container) return;

    const s = state.masterSettings || {};

    CardRenderer.renderInto(container, {
      title: state.form.title,
      guestName: state.form.name.trim() || 'अतिथि महोदय का नाम',
      guestAbout: state.form.about.trim() || 'पद / परिचय / पता यहाँ प्रदर्शित होगा...',
      guestBadge: state.form.badge.trim() || 'विशिष्ट अतिथि',
      photoUrl: state.form.photoData,
      theme: state.form.theme,
      cardCode: state.form.cardCode,
      checksum: state.form.checksum || 'SN-CHECKSUM',
      programName: s.program_name || 'सदानीरा महोत्सव 2026',
      programSubtitle: s.program_subtitle || 'सांस्कृतिक, साहित्यिक एवं कला महासमागम',
      invocation: s.invocation || '॥ सदानीरा जीवनदायिनी संस्कृतिधारा ॥',
      invitationMessage: s.invitation_message || '"आपको सादर आमंत्रित करते हुए हमें अपार हर्ष हो रहा है। आपकी गरिमामयी उपस्थिति इस सांस्कृतिक अनुष्ठान को नव ऊर्जा एवं भव्यता प्रदान करेगी।"',
      eventDate: state.form.eventDate || s.event_date || '15-17 नवंबर 2026',
      eventTime: state.form.eventTime || s.event_time || 'सायं 5:00 बजे से',
      eventVenue: state.form.eventVenue || s.event_venue || 'मुख्य सांस्कृतिक प्रेक्षागृह, सदानीरा परिसर',
      organizer: s.organizer_name || 'समस्त आयोजन समिति, सदानीरा महोत्सव न्यास'
    });
  }

  // ==========================================================================
  // Save & Record New Card in Database
  // ==========================================================================
  document.getElementById('btnSaveRecord')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnSaveRecord');
    btn.disabled = true;
    btn.textContent = 'सहेजा जा रहा है...';

    try {
      const payload = {
        title: state.form.title,
        gender: state.form.gender,
        guest_name: state.form.name.trim(),
        guest_about: state.form.about.trim(),
        guest_badge: state.form.badge.trim() || 'विशिष्ट अतिथि',
        theme: state.form.theme,
        event_date: state.form.eventDate,
        event_time: state.form.eventTime,
        event_venue: state.form.eventVenue,
        photo_base64: state.form.photoData
      };

      const res = await API.createCard(payload);

      // Update the preview with the code/checksum returned by the server.
      state.form.cardCode = res.card.card_code;
      state.form.checksum = res.card.checksum ? `SN-${res.card.checksum.slice(0,8).toUpperCase()}` : state.form.checksum;
      renderLivePreview();

      // One-click workflow: the same Save action both stores the invitation
      // online and downloads the final PNG locally.
      const cardNode = document.querySelector('#liveCardContainer .invitation-card');
      if (!cardNode) throw new Error('कार्ड पूर्वावलोकन तैयार नहीं हो सका।');

      const filename = `Sadaneera_Invitation_${(state.form.name || 'Card').replace(/[^a-zA-Z0-9_\u0900-\u097F-]+/g, '_')}.png`;
      await CardRenderer.exportPNG(cardNode, filename);

      showToast(`कार्ड ${res.card.card_code} वेबसाइट पर सुरक्षित हो गया और PNG डाउनलोड हो गया।`, 'success');
    } catch (err) {
      showToast(err.message || 'कार्ड सहेजने में विफल', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 सहेजें व कोड उत्पन्न करें (Save to Records)';
    }
  });

  // Direct PNG / PDF Download from Generator
  document.getElementById('btnDownloadPng')?.addEventListener('click', async () => {
    const cardNode = document.querySelector('#liveCardContainer .invitation-card');
    if (!cardNode) return;
    try {
      const filename = `Sadaneera_Invitation_${(state.form.name || 'Card').replace(/[^a-zA-Z0-9_\u0900-\u097F-]+/g, '_')}.png`;
      await CardRenderer.exportPNG(cardNode, filename);
      showToast('निमंत्रण पत्र PNG डाउनलोड हो गया है', 'success');
    } catch (err) {
      showToast(err.message || 'PNG डाउनलोड नहीं हो सका', 'error');
    }
  });

  document.getElementById('btnDownloadPdf')?.addEventListener('click', async () => {
    const cardNode = document.querySelector('#liveCardContainer .invitation-card');
    if (!cardNode) return;
    try {
      const filename = `Sadaneera_Invitation_${(state.form.name || 'Card').replace(/[^a-zA-Z0-9_\u0900-\u097F-]+/g, '_')}.pdf`;
      await CardRenderer.exportPDF(cardNode, filename);
      showToast('निमंत्रण पत्र PDF डाउनलोड हो गया है', 'success');
    } catch (err) {
      showToast(err.message || 'PDF डाउनलोड नहीं हो सका', 'error');
    }
  });

  // Reset Generator Form
  document.getElementById('btnResetForm')?.addEventListener('click', () => {
    if (!confirm('क्या आप फॉर्म के सभी फ़ील्ड रीसेट करना चाहते हैं?')) return;
    state.form.name = '';
    state.form.about = '';
    state.form.badge = 'विशिष्ट अतिथि';
    state.form.photoData = DEFAULT_AVATAR;
    state.form.cardCode = 'SN-0001-XXXX';
    inputGuestName.value = '';
    inputGuestAbout.value = '';
    if (inputGuestBadge) inputGuestBadge.value = 'विशिष्ट अतिथि';
    photoFileInput.value = '';
    document.getElementById('photoPreviewWrap').style.display = 'none';
    document.getElementById('photoUploadPlaceholder').style.display = 'block';
    setGenderAndTitle('male');
    showToast('फॉर्म रीसेट कर दिया गया', 'info');
  });

  // ==========================================================================
  // Module 3: Records Table & On-the-fly Regeneration
  // ==========================================================================
  async function loadRecords() {
    const tbody = document.getElementById('recordsTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">लोड हो रहा है...</td></tr>`;

    try {
      const res = await API.getCards(state.recordsFilter);
      renderRecordsTable(res.cards || []);
      document.getElementById('totalRecordsBadge').textContent = `${res.total || 0} निमंत्रण कार्ड`;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--danger); padding: 1.5rem;">त्रुटि: ${err.message}</td></tr>`;
    }
  }

  function renderRecordsTable(cards) {
    const tbody = document.getElementById('recordsTableBody');
    if (!tbody) return;

    if (cards.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">कोई रिकॉर्ड उपलब्ध नहीं है। कृपया कार्ड जेनरेटर से नया निमंत्रण बनाएं।</td></tr>`;
      return;
    }

    tbody.innerHTML = cards.map(c => {
      const photoSrc = c.photo_url || DEFAULT_AVATAR;
      const shortHash = c.checksum ? `SN-${c.checksum.slice(0, 8).toUpperCase()}` : 'N/A';
      const createdDate = new Date(c.created_at).toLocaleDateString('hi-IN', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
      const badgeLabel = c.guest_badge || 'विशिष्ट अतिथि';
      const deleted = Number(c.is_deleted) === 1;
      const deletedBy = c.deleted_by_name ? `डिलीट बाय: ${c.deleted_by_name}` : 'डिलीट बाय: मुख्य प्रशासन';

      const actionButtons = deleted
        ? `<div class="deleted-action-label"><strong>🗑️ डिलीटेड</strong><span>${deletedBy}</span></div>`
        : `
          <button class="action-btn" title="कार्ड पुनः उत्पन्न व डाउनलोड करें" onclick="window.regenerateCardModal(${c.id})">🔄 पुनः उत्पन्न करें</button>
          <button class="action-btn" title="एडिट या डुप्लीकेट करें" onclick="window.duplicateCardToForm(${c.id})">✏️ डुप्लीकेट</button>
          <button class="action-btn delete" title="डिलीट मार्क करें" onclick="window.deleteCardRecord(${c.id})">🗑️ हटाएं</button>
        `;

      return `
        <tr class="${deleted ? 'record-deleted-row' : ''}" style="${deleted ? 'opacity:0.72;' : ''}">
          <td>
            <span class="card-code-badge ${deleted ? 'deleted' : 'active'}" title="पहले 4 अंक = कार्ड का स्थायी क्रमांक; डैश के बाद 4 अंक = unique random suffix">${c.card_code}</span>
          </td>
          <td>
            <div class="guest-cell-profile">
              <img src="${photoSrc}" alt="${c.guest_name}" class="guest-table-avatar" />
              <div class="guest-info-text">
                <div class="name"><span class="title">${c.title}</span>${c.guest_name}</div>
                <div style="font-size:0.75rem;color:var(--primary);font-weight:700;">[ ${badgeLabel} ]</div>
                <div class="about" title="${c.guest_about}">${c.guest_about}</div>
              </div>
            </div>
          </td>
          <td><span style="font-size:0.8rem;font-weight:700;text-transform:capitalize;">${c.theme}</span></td>
          <td><span title="${c.checksum}" style="font-family:monospace;font-size:0.75rem;color:var(--text-muted);">${shortHash}</span></td>
          <td>
            <div style="font-size:0.85rem;font-weight:600;">${c.created_by_name}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${createdDate}</div>
          </td>
          <td><div class="action-btn-group">${actionButtons}</div></td>
        </tr>
      `;
    }).join('');
  }

  window.regenerateCardModal = async function(cardId) {
    try {
      const res = await API.getCardById(cardId);
      const card = res.card;
      if (!card) return;
      if (Number(card.is_deleted) === 1) {
        showToast('यह कार्ड डिलीटेड है; एडिट/डुप्लीकेट लॉक है।', 'error');
        return;
      }
      if (Number(card.is_deleted) === 1) {
        showToast('यह कार्ड डिलीटेड है; पुनः उत्पन्न/डाउनलोड लॉक है।', 'error');
        return;
      }

      const s = res.masterSettings || state.masterSettings || {};
      const modalContainer = document.getElementById('regenerateCardContainer');
      const modalMeta = document.getElementById('regenerateCardMeta');

      // Re-render card purely on the fly in the DOM in portrait mode without saving images in DB!
      CardRenderer.renderInto(modalContainer, {
        title: card.title,
        guestName: card.guest_name,
        guestAbout: card.guest_about,
        guestBadge: card.guest_badge || 'विशिष्ट अतिथि',
        photoUrl: card.photo_url,
        theme: card.theme,
        cardCode: card.card_code,
        checksum: card.checksum ? `SN-${card.checksum.slice(0,8).toUpperCase()}` : 'VERIFIED',
        programName: s.program_name || 'सदानीरा महोत्सव 2026',
        programSubtitle: s.program_subtitle || 'सांस्कृतिक, साहित्यिक एवं कला महासमागम',
        invocation: s.invocation || '॥ सदानीरा जीवनदायिनी संस्कृतिधारा ॥',
        invitationMessage: s.invitation_message || '"आपको सादर आमंत्रित करते हुए हमें अपार हर्ष हो रहा है। आपकी गरिमामयी उपस्थिति इस सांस्कृतिक अनुष्ठान को नव ऊर्जा एवं भव्यता प्रदान करेगी।"',
        eventDate: card.event_date || s.event_date || '15-17 नवंबर 2026',
        eventTime: card.event_time || s.event_time || 'सायं 5:00 बजे से',
        eventVenue: card.event_venue || s.event_venue || 'मुख्य सांस्कृतिक प्रेक्षागृह, सदानीरा परिसर',
        organizer: s.organizer_name || 'समस्त आयोजन समिति, सदानीरा महोत्सव न्यास'
      });

      // Update meta info
      modalMeta.innerHTML = `
        <strong>कार्ड कोड:</strong> ${card.card_code} | 
        <strong>अतिथि:</strong> ${card.title} ${card.guest_name} [${card.guest_badge || 'विशिष्ट अतिथि'}] | 
        <strong>प्रशासक:</strong> ${card.created_by_name}
      `;

      // Setup Modal Download Buttons
      document.getElementById('btnModalDownloadPng').onclick = () => {
        const cardNode = modalContainer.querySelector('.invitation-card');
        CardRenderer.exportPNG(cardNode, `Sadaneera_${card.card_code}_${card.guest_name.replace(/\s+/g,'_')}.png`);
        showToast('पोर्ट्रेट कार्ड PNG डाउनलोड हो रहा है...', 'success');
      };

      document.getElementById('btnModalDownloadPdf').onclick = () => {
        const cardNode = modalContainer.querySelector('.invitation-card');
        CardRenderer.exportPDF(cardNode, `Sadaneera_${card.card_code}_${card.guest_name.replace(/\s+/g,'_')}.pdf`);
        showToast('पोर्ट्रेट कार्ड PDF डाउनलोड हो रहा है...', 'info');
      };

      document.getElementById('btnModalPrint').onclick = () => {
        window.print();
      };

      regenerateModal.showModal();
    } catch (err) {
      showToast('रिकॉर्ड प्राप्त करने में विफल: ' + err.message, 'error');
    }
  };

  document.getElementById('btnCloseRegenerateModal')?.addEventListener('click', () => {
    regenerateModal.close();
  });

  // Duplicate / Edit record to Generator
  window.duplicateCardToForm = async function(cardId) {
    try {
      const res = await API.getCardById(cardId);
      const card = res.card;
      if (!card) return;

      state.form.gender = card.gender;
      state.form.title = card.title;
      state.form.name = card.guest_name;
      state.form.about = card.guest_about;
      state.form.badge = card.guest_badge || 'विशिष्ट अतिथि';
      state.form.theme = card.theme;
      state.form.photoData = card.photo_url;
      state.form.eventDate = card.event_date;
      state.form.eventTime = card.event_time;
      state.form.eventVenue = card.event_venue;
      state.form.cardCode = `${card.card_code}-COPY`;

      // Update inputs
      inputGuestName.value = card.guest_name;
      inputGuestAbout.value = card.guest_about;
      if (inputGuestBadge) inputGuestBadge.value = state.form.badge;
      selectTheme.value = card.theme;
      inputEventDate.value = card.event_date;
      inputEventTime.value = card.event_time;
      inputEventVenue.value = card.event_venue;

      // Update photo preview
      document.getElementById('photoThumbnail').src = card.photo_url;
      document.getElementById('photoUploadPlaceholder').style.display = 'none';
      document.getElementById('photoPreviewWrap').style.display = 'flex';

      setGenderAndTitle(card.gender);
      switchTab('generator');
      showToast(`रिकॉर्ड ${card.card_code} जेनरेटर में लोड किया गया`, 'info');
    } catch (err) {
      showToast('लोड करने में असमर्थ: ' + err.message, 'error');
    }
  };

  // Delete Card Record
  window.deleteCardRecord = async function(cardId) {
    if (!confirm('यह कार्ड डिलीटेड मार्क होगा। रिकॉर्ड और अतिथि फोटो सुरक्षित रहेंगे तथा पुनः उत्पन्न/एडिट/डिलीट क्रियाएं लॉक हो जाएंगी। आगे बढ़ें?')) return;

    try {
      const res = await API.deleteCard(cardId);
      showToast(res.message || 'रिकॉर्ड हटा दिया गया', 'success');
      loadRecords();
    } catch (err) {
      showToast(err.message || 'रिकॉर्ड हटाने में असमर्थ', 'error');
    }
  };

  // ==========================================================================
  // Module 2: Admin Management (Super Admin View)
  // ==========================================================================
  async function loadAdminsList() {
    const tbody = document.getElementById('adminsTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">लोड हो रहा है...</td></tr>`;

    try {
      const res = await API.getAdmins();
      renderAdminsTable(res.users || []);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--danger); padding: 1.5rem;">त्रुटि: ${err.message}</td></tr>`;
    }
  }

  function renderAdminsTable(users) {
    const tbody = document.getElementById('adminsTableBody');
    if (!tbody) return;

    tbody.innerHTML = users.map(u => {
      const isSuper = u.role === 'superadmin';
      const isCurrent = state.user?.id === u.id;
      const statusPill = u.is_active === 1 
        ? `<span class="table-status-pill active">सक्रिय (Active)</span>` 
        : `<span class="table-status-pill inactive">निष्क्रिय (Disabled)</span>`;

      const roleBadge = `<span class="role-tag ${u.role}">${u.role}</span>`;

      let actionButtons = '';
      if (!isCurrent && u.username !== 'superadmin') {
        const toggleLabel = u.is_active === 1 ? 'रोकें (Deactivate)' : 'सक्रिय करें (Activate)';
        actionButtons = `
          <button class="action-btn" onclick="window.toggleAdminState(${u.id})">${toggleLabel}</button>
          <button class="action-btn delete" onclick="window.deleteAdminUser(${u.id}, '${u.username}')">🗑️ हटाएं</button>
        `;
      } else {
        actionButtons = `<span style="font-size:0.75rem; color:var(--text-muted); font-style:italic;">सुरक्षित खाता</span>`;
      }

      return `
        <tr>
          <td>
            <div style="font-weight:700;">${u.full_name}</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">${u.email || 'ईमेल नहीं'}</div>
          </td>
          <td><code>${u.username}</code></td>
          <td>${roleBadge}</td>
          <td><strong style="color:var(--primary); font-size:1.1rem;">${u.cards_generated || 0}</strong></td>
          <td>${statusPill}</td>
          <td><div class="action-btn-group">${actionButtons}</div></td>
        </tr>
      `;
    }).join('');
  }

  // Create New Admin Form Handler
  document.getElementById('createAdminForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'बनाया जा रहा है...';

    const full_name = document.getElementById('newAdminFullName').value;
    const username = document.getElementById('newAdminUsername').value;
    const email = document.getElementById('newAdminEmail').value;
    const password = document.getElementById('newAdminPassword').value;
    const role = document.getElementById('newAdminRole').value;

    try {
      const res = await API.createAdmin({ full_name, username, email, password, role });
      showToast(res.message || 'नया प्रशासक खाता सफलतापूर्वक बनाया गया!', 'success');
      e.target.reset();
      loadAdminsList();
    } catch (err) {
      showToast(err.message || 'प्रशासक खाता बनाने में विफल', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '➕ प्रशासक बनाएं (Create Admin)';
    }
  });

  window.toggleAdminState = async function(userId) {
    try {
      const res = await API.toggleAdminStatus(userId);
      showToast(res.message, 'success');
      loadAdminsList();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.deleteAdminUser = async function(userId, username) {
    if (!confirm(`क्या आप प्रशासक "${username}" को स्थायी रूप से हटाना चाहते हैं?`)) return;
    try {
      const res = await API.deleteAdmin(userId);
      showToast(res.message, 'success');
      loadAdminsList();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Super Admin: production reset of all invitation records + uploaded guest photos.
  document.getElementById('btnResetAllCards')?.addEventListener('click', async () => {
    const password = document.getElementById('resetAllCardsPassword')?.value || '';
    const phrase = document.getElementById('resetAllCardsPhrase')?.value.trim() || '';
    if (!password || !phrase) {
      showToast('Super Admin password और confirmation phrase दोनों आवश्यक हैं।', 'error');
      return;
    }
    if (phrase !== 'DELETE ALL CARDS') {
      showToast('Confirmation phrase सही नहीं है।', 'error');
      return;
    }
    if (!confirm('अंतिम चेतावनी: सभी invitation records और uploads की files स्थायी रूप से हट जाएंगी। Users और master settings सुरक्षित रहेंगे। क्या आप जारी रखना चाहते हैं?')) return;

    const btn = document.getElementById('btnResetAllCards');
    btn.disabled = true;
    btn.textContent = 'डेटा साफ किया जा रहा है...';
    try {
      const res = await API.resetAllCards(password, phrase);
      showToast(res.message || 'सभी कार्ड डेटा साफ कर दिया गया।', 'success');
      document.getElementById('resetAllCardsPassword').value = '';
      document.getElementById('resetAllCardsPhrase').value = '';
      await loadRecords();
      await loadDashboard();
    } catch (err) {
      showToast(err.message || 'Reset असफल रहा।', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🗑️ सभी कार्ड डेटा साफ करें';
    }
  });

  // ==========================================================================
  // Dashboard Overview Metrics
  // ==========================================================================
  function formatDashboardDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString('hi-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderShareChart(containerId, admins, percentageKey, countKey, emptyText) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const rows = (admins || []).filter(a => Number(a[countKey] || 0) > 0);
    if (!rows.length) {
      el.innerHTML = `<div class="share-chart-empty">${emptyText}</div>`;
      return;
    }
    el.innerHTML = rows.map(a => {
      const pct = Number(a[percentageKey] || 0);
      const count = Number(a[countKey] || 0);
      return `
        <div class="share-row">
          <div class="share-row-head">
            <strong>${a.full_name}</strong>
            <span>${count} कार्ड · ${pct.toFixed(1)}%</span>
          </div>
          <div class="share-track" aria-label="${a.full_name}: ${pct.toFixed(1)} प्रतिशत">
            <div class="share-fill" style="width:${Math.min(100, Math.max(0, pct))}%"></div>
          </div>
        </div>`;
    }).join('');
  }

  async function loadDashboard() {
    try {
      const res = await API.getDashboardStats();
      const stats = res.stats || {};

      document.getElementById('statTotalCards').textContent = stats.totalCards || 0;
      document.getElementById('statTodayCards').textContent = stats.todayCards || 0;
      document.getElementById('statTotalAdmins').textContent = stats.totalAdmins || 0;
      document.getElementById('statMyCards').textContent = stats.myCards || 0;

      const admins = stats.adminActivity || [];
      const activityBody = document.getElementById('adminActivityTableBody');
      if (activityBody) {
        if (!admins.length) {
          activityBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--text-muted);">अभी कोई एडमिन रिकॉर्ड उपलब्ध नहीं है।</td></tr>`;
        } else {
          activityBody.innerHTML = admins.map(a => `
            <tr>
              <td>
                <div style="font-weight:800;">${a.full_name}</div>
                <div style="font-size:.72rem;color:var(--text-muted);">@${a.username}</div>
              </td>
              <td>${formatDashboardDate(a.admin_created_at)}</td>
              <td><strong class="dashboard-number">${a.total_cards}</strong></td>
              <td>${a.active_cards}</td>
              <td>${a.deleted_actions}</td>
              <td><strong>${a.today_cards}</strong></td>
            </tr>
          `).join('');
        }
      }

      const lifetimeTotal = Number(stats.lifetimeTotal || 0);
      const todayTotal = Number(stats.todayTotal || 0);
      const lifetimeBadge = document.getElementById('dashboardLifetimeTotal');
      const lifetimeChartTotal = document.getElementById('dashboardLifetimeChartTotal');
      const todayChartTotal = document.getElementById('dashboardTodayChartTotal');
      if (lifetimeBadge) lifetimeBadge.textContent = `${lifetimeTotal} कुल कार्ड`;
      if (lifetimeChartTotal) lifetimeChartTotal.textContent = `${lifetimeTotal} कार्ड`;
      if (todayChartTotal) todayChartTotal.textContent = `${todayTotal} कार्ड`;

      renderShareChart('lifetimeShareChart', admins, 'lifetime_percentage', 'total_cards', 'अभी कोई lifetime card नहीं बना है।');
      renderShareChart('todayShareChart', admins, 'today_percentage', 'today_cards', 'आज अभी कोई card नहीं बना है।');

      // Recent activity is intentionally capped at 10.
      const recentList = document.getElementById('dashboardRecentCards');
      if (recentList) {
        const recent = (stats.recentCards || []).slice(0, 10);
        if (!recent.length) {
          recentList.innerHTML = `<p style="padding:1.5rem;text-align:center;color:var(--text-muted);">कोई हालिया निमंत्रण नहीं मिला।</p>`;
        } else {
          recentList.innerHTML = recent.map(c => {
            const deleted = Number(c.is_deleted) === 1;
            const action = deleted
              ? `<span class="table-status-pill inactive">🗑️ डिलीटेड — क्रियाएं लॉक</span>`
              : `<button class="action-btn" onclick="window.regenerateCardModal(${c.id})">पुनः देखें</button>`;
            return `
              <div class="dashboard-recent-item ${deleted ? 'record-deleted-row' : ''}">
                <div class="dashboard-recent-main">
                  <img src="${c.photo_url || DEFAULT_AVATAR}" alt="${c.guest_name}" />
                  <div>
                    <div style="font-weight:800;font-size:.9rem;">${c.title} ${c.guest_name}</div>
                    <div style="font-size:.74rem;color:var(--text-muted);">${c.card_code} · ${c.created_by_name} · ${formatDashboardDate(c.created_at)}</div>
                  </div>
                </div>
                ${action}
              </div>`;
          }).join('');
        }
      }
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    }
  }

  // Initialize
  checkAuth();
  setGenderAndTitle('male');
  applyPreviewScale();
});
