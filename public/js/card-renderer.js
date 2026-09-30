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
    const photoUrl = data.photoUrl || '/assets/avatar-placeholder.svg';
    const theme = data.theme || 'royal-gold';
    const cardCode = data.cardCode || 'SN-0001-XXXX';
    const checksum = data.checksum || 'VERIFIED';
    const contactNumbers = ['9123220920', '8651419161', '9661779398', '7808953784'];
    
    // Global contents managed by Super Admin
    const programName = data.programName || 'सदानीरा महोत्सव 2026';
    const programSubtitle = data.programSubtitle || 'साहित्य, संगीत, सिनेमा';
    const invocation = data.invocation || '॥ सदानीरा जीवनदायिनी संस्कृतिधारा ॥';
    // Keep a single presentation line; never render a duplicate.
    const presentationLine = String(data.presentationLine || '').trim();
    // Strip any foundation/presentation phrase already embedded in invocation so it renders only once.
    const cleanInvocation = String(invocation)
      .replace(/चरणाश्रय[ी]?\s*फाउंडेशन\s*की\s*प्रस्तुति/g, '')
      .trim();
    const invitationMessage = data.invitationMessage || '"आपको सादर आमंत्रित करते हुए हमें अपार हर्ष हो रहा है। आपकी गरिमामयी उपस्थिति इस सांस्कृतिक अनुष्ठान को नव ऊर्जा एवं भव्यता प्रदान करेगी।"';
    const eventDate = data.eventDate || '15-17 नवंबर 2026';
    const eventTime = data.eventTime || 'सायं 5:00 बजे से';
    const eventVenue = data.eventVenue || 'मुख्य सांस्कृतिक प्रेक्षागृह, सदानीरा परिसर';
    const organizer = data.organizer || 'समस्त आयोजन समिति, सदानीरा महोत्सव न्यास';
    const venueHtml = String(eventVenue).includes(',')
      ? String(eventVenue).replace(',', '<br>')
      : eventVenue;

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
          <div class="card-invocation">${cleanInvocation}</div>
          <div class="card-presentation-line">${presentationLine}</div>
          <div class="sadaneera-logo-wrap">
            <img src="/assets/Sadanira-logo.png" alt="सदानीरा महोत्सव" class="sadaneera-logo" crossorigin="anonymous" />
          </div>
          <h1 class="card-main-title">${programName}</h1>
          <div class="lit-festival-line"><span>देहात का पहला </span><span class="lit-latin">Lit festival</span></div>
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
          <div class="guest-photo-stage">
            <div class="letter-rain letter-rain-left" aria-hidden="true">
              <span>अ</span><span>क</span><span>र</span><span>A</span><span>म</span><span>ग</span><span>क</span><span>न</span><span>B</span><span>स</span><span>ल</span><span>O</span><span>𑂃</span><span>ख</span><span>R</span><span>त</span><span>प</span><span>𑂍</span>
            </div>
            <div class="letter-rain letter-rain-right" aria-hidden="true">
              <span>श</span><span>त</span><span>क</span><span>R</span><span>आ</span><span>प</span><span>ल</span><span>C</span><span>म</span><span>य</span><span>D</span><span>ह</span><span>𑂩</span><span>ब</span><span>G</span><span>न</span><span>ओ</span><span>𑂯</span>
            </div>
            <div class="guest-photo-container">
              <div class="guest-photo-frame">
              <div class="guest-photo-inner">
                <img src="${photoUrl}" alt="${guestName}" crossorigin="anonymous" />
              </div>
            </div>
              <div class="guest-honor-badge">सप्रेम निमंत्रण</div>
            </div>
          </div>

          <div class="guest-text-details">
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
              <div class="value">${venueHtml}</div>
            </div>
          </div>
        </section>

        <!-- Footer / RSVP Section -->
        <footer class="card-footer-section">
          <div class="rsvp-block">
            <div class="rsvp-title">विनीत एवं स्वागताकांक्षी:</div>
            <div class="rsvp-name">${organizer}</div>
          </div>

          <div class="contact-block" aria-label="संपर्क सूत्र">
            <div class="contact-title">संपर्क सूत्र</div>
            <div class="contact-row contact-row-all">
              <span class="contact-item">│&nbsp;${contactNumbers[0]}</span>
              <span class="contact-item">│&nbsp;${contactNumbers[1]}</span>
              <span class="contact-item">│&nbsp;${contactNumbers[2]}</span>
              <span class="contact-item">│&nbsp;${contactNumbers[3]}</span>
            </div>
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
      throw new Error('PNG rendering library is loading. Please try again.');
    }
    if (!cardElement) {
      throw new Error('कार्ड पूर्वावलोकन उपलब्ध नहीं है।');
    }

    // Never render the responsive/mobile preview directly. Create a fixed-size
    // export surface so phones do not inherit viewport transforms or layout
    // constraints. The invitation artwork itself is always 720x1040 CSS px.
    const exportHost = document.createElement('div');
    exportHost.style.position = 'fixed';
    exportHost.style.left = '-10000px';
    exportHost.style.top = '0';
    exportHost.style.width = '720px';
    exportHost.style.height = '1040px';
    exportHost.style.overflow = 'hidden';
    exportHost.style.background = 'transparent';
    exportHost.style.zIndex = '-1';

    const exportCard = cardElement.cloneNode(true);
    exportCard.removeAttribute('id');
    exportCard.style.width = '720px';
    exportCard.style.height = '1040px';
    exportCard.style.transform = 'none';
    exportCard.style.margin = '0';
    exportCard.style.position = 'relative';
    exportCard.style.left = '0';
    exportCard.style.top = '0';

    exportHost.appendChild(exportCard);
    document.body.appendChild(exportHost);

    try {
      // Give cloned images a chance to decode before html2canvas starts.
      const images = Array.from(exportCard.querySelectorAll('img'));
      await Promise.all(images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      }));

      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      // 2x is high enough for a sharp invitation and considerably safer on
      // mobile browsers than the previous 2.5x canvas.
      const canvas = await window.html2canvas(exportCard, {
        width: 720,
        height: 1040,
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        imageTimeout: 15000,
        removeContainer: true
      });

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas rendering context 2D उपलब्ध नहीं हो सका।');
      }

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG तैयार नहीं हो सका।')), 'image/png');
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();

      // Delay revocation slightly so mobile browsers have time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } finally {
      exportHost.remove();
    }
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
