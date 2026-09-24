/**
 * Sadaneera Mahotsav - Card Rendering Engine (Portrait Edition)
 * Generates identical, pixel-perfect, high-res portrait invitation cards
 * with large guest photo frame and editable honor badge.
 */

const CardRenderer = {
  getCornerSvg() {
    return `
      <svg class="corner-svg" viewBox="0 0 100 100">
        <path d="M 0,0 L 90,0 C 80,10 60,10 50,25 C 40,40 40,60 25,75 C 10,90 0,90 0,100 Z" opacity="0.35"/>
        <path d="M 5,5 L 60,5 C 50,15 40,25 30,40 C 20,55 15,70 5,80 Z" />
        <circle cx="22" cy="22" r="6" fill="#ffd700" />
      </svg>
    `;
  },

  /**
   * Produce the complete Portrait HTML string for the invitation card
   * @param {Object} data 
   */
  generateHTML(data) {
    const title = data.title || 'श्री';
    const guestName = data.guestName || 'अतिथि महोदय';
    const guestAbout = data.guestAbout || 'विशिष्ट आमंत्रित सदस्य एवं गणमान्य अतिथि';
    const guestBadge = data.guestBadge || 'विशिष्ट अतिथि';
    const photoUrl = data.photoUrl || '/assets/avatar-placeholder.svg';
    const theme = data.theme || 'royal-gold';
    const cardCode = data.cardCode || 'SN-00001-XXXX';
    const checksum = data.checksum || 'VERIFIED';
    
    // Global contents managed by Super Admin
    const programName = data.programName || 'सदानीरा महोत्सव 2026';
    const programSubtitle = data.programSubtitle || 'सांस्कृतिक, साहित्यिक एवं कला महासमागम';
    const invocation = data.invocation || '॥ सदानीरा जीवनदायिनी संस्कृतिधारा ॥';
    const invitationMessage = data.invitationMessage || '"आपको सादर आमंत्रित करते हुए हमें अपार हर्ष हो रहा है। आपकी गरिमामयी उपस्थिति इस सांस्कृतिक अनुष्ठान को नव ऊर्जा एवं भव्यता प्रदान करेगी।"';
    const eventDate = data.eventDate || '15-17 नवंबर 2026';
    const eventTime = data.eventTime || 'सायं 5:00 बजे से';
    const eventVenue = data.eventVenue || 'मुख्य सांस्कृतिक प्रेक्षागृह, सदानीरा परिसर';
    const organizer = data.organizer || 'समस्त आयोजन समिति, सदानीरा महोत्सव न्यास';

    const cornerMarkup = this.getCornerSvg();

    return `
      <div class="invitation-card theme-${theme}" id="renderedCardNode">
        <!-- Decorative Frames & Corners -->
        <div class="card-border-outer"></div>
        <div class="card-border-inner"></div>
        <div class="corner-flourish corner-tl">${cornerMarkup}</div>
        <div class="corner-flourish corner-tr">${cornerMarkup}</div>
        <div class="corner-flourish corner-bl">${cornerMarkup}</div>
        <div class="corner-flourish corner-br">${cornerMarkup}</div>

        <!-- Header Section (Managed by Super Admin) -->
        <header class="card-header-section">
          <div class="card-invocation">${invocation}</div>
          <h1 class="card-main-title">${programName}</h1>
          <div class="card-subtitle">${programSubtitle}</div>
          <div class="card-divider">
            <span class="line"></span>
            <span class="symbol">✦ ॐ ✦</span>
            <span class="line"></span>
          </div>
        </header>

        <!-- Body Section: Big Photo & Guest Details -->
        <main class="card-body-section">
          <!-- Big 225px Photo Container -->
          <div class="guest-photo-container">
            <div class="guest-photo-frame">
              <div class="guest-photo-inner">
                <img src="${photoUrl}" alt="${guestName}" crossorigin="anonymous" />
              </div>
            </div>
            <!-- Editable Honor Badge -->
            <div class="guest-honor-badge">${guestBadge}</div>
          </div>

          <div class="guest-text-details">
            <div class="guest-invitation-lead">सादर सप्रेम निमंत्रण</div>
            <h2 class="guest-full-name">
              <span class="guest-title-prefix">${title}</span>${guestName}
            </h2>
            <div class="guest-about-text">${guestAbout}</div>
            
            <div class="guest-cordial-note">
              ${invitationMessage}
            </div>
          </div>
        </main>

        <!-- Event Details Bar -->
        <section class="card-event-section">
          <div class="event-detail-item">
            <span class="icon">📅</span>
            <div>
              <div class="label">दिनांक / Date</div>
              <div class="value">${eventDate}</div>
            </div>
          </div>
          <div class="event-detail-item">
            <span class="icon">⏰</span>
            <div>
              <div class="label">समय / Time</div>
              <div class="value">${eventTime}</div>
            </div>
          </div>
          <div class="event-detail-item">
            <span class="icon">🏛️</span>
            <div>
              <div class="label">स्थान / Venue</div>
              <div class="value">${eventVenue}</div>
            </div>
          </div>
        </section>

        <!-- Footer / RSVP Section -->
        <footer class="card-footer-section">
          <div class="rsvp-block">
            <div class="rsvp-title">विनीत एवं स्वागताकांक्षी:</div>
            <div class="rsvp-name">${organizer}</div>
          </div>

          <div class="card-security-block">
            <div><span class="card-code-badge">${cardCode}</span></div>
            <div title="Data Integrity Checksum">Checksum: <strong>${checksum}</strong></div>
          </div>
        </footer>
      </div>
    `;
  },

  renderInto(containerEl, data) {
    if (!containerEl) return;
    containerEl.innerHTML = this.generateHTML(data);
  },

  async exportPNG(cardElement, filename = 'Sadaneera_Invitation.png') {
    if (!window.html2canvas) {
      alert('html2canvas library is loading, please try again.');
      return;
    }

    const canvas = await window.html2canvas(cardElement, {
      scale: 2.5,
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      logging: false
    });

    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png', 1.0);
    link.click();
  },

  async exportPDF(cardElement, filename = 'Sadaneera_Invitation.pdf') {
    if (!window.html2canvas || !window.jspdf) {
      alert('PDF generation libraries loading, please try again.');
      return;
    }

    const canvas = await window.html2canvas(cardElement, {
      scale: 2.5,
      useCORS: true,
      allowTaint: true,
      logging: false
    });

    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;

    // Portrait orientation for portrait cards!
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth - 20; // 10mm left/right margin
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const yPos = (pageHeight - imgHeight) / 2;
    pdf.addImage(imgData, 'PNG', 10, yPos > 10 ? yPos : 10, imgWidth, imgHeight);
    pdf.save(filename);
  }
};

window.CardRenderer = CardRenderer;
