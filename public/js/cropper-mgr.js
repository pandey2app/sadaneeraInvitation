/**
 * Sadaneera Mahotsav - Interactive Image Cropper Manager
 * Built with Cropper.js for circular/square headshots
 */

class CropperManager {
  constructor(options = {}) {
    this.modal = document.getElementById('cropperModal');
    this.imageElement = document.getElementById('cropperImage');
    this.cropper = null;
    this.onCropComplete = options.onCropComplete || (() => {});
    this.initControls();
  }

  initControls() {
    document.getElementById('btnZoomIn')?.addEventListener('click', () => {
      this.cropper?.zoom(0.1);
    });

    document.getElementById('btnZoomOut')?.addEventListener('click', () => {
      this.cropper?.zoom(-0.1);
    });

    document.getElementById('btnRotateLeft')?.addEventListener('click', () => {
      this.cropper?.rotate(-90);
    });

    document.getElementById('btnRotateRight')?.addEventListener('click', () => {
      this.cropper?.rotate(90);
    });

    document.getElementById('btnResetCrop')?.addEventListener('click', () => {
      this.cropper?.reset();
    });

    document.getElementById('btnApplyCrop')?.addEventListener('click', () => {
      this.applyCrop();
    });

    document.getElementById('btnCloseCropper')?.addEventListener('click', () => {
      this.closeModal();
    });
  }

  /**
   * Load an image file or URL into cropper
   */
  loadImage(source) {
    if (!this.modal || !this.imageElement) return;

    if (this.cropper) {
      this.cropper.destroy();
      this.cropper = null;
    }

    if (source instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.imageElement.src = e.target.result;
        this.openModal();
      };
      reader.readAsDataURL(source);
    } else if (typeof source === 'string') {
      this.imageElement.src = source;
      this.openModal();
    }
  }

  openModal() {
    this.modal.showModal();

    // Small delay to ensure modal is rendered and dimensions are known
    setTimeout(() => {
      if (this.cropper) {
        this.cropper.destroy();
      }

      this.cropper = new Cropper(this.imageElement, {
        aspectRatio: 1, // 1:1 square for circular portrait badge
        viewMode: 1,
        autoCropArea: 0.85,
        responsive: true,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        background: false
      });
    }, 100);
  }

  closeModal() {
    if (this.cropper) {
      this.cropper.destroy();
      this.cropper = null;
    }
    this.modal.close();
  }

  applyCrop() {
    if (!this.cropper) return;

    // Export cropped canvas at 500x500 high resolution
    const canvas = this.cropper.getCroppedCanvas({
      width: 500,
      height: 500,
      fillColor: '#fff',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });

    const croppedBase64 = canvas.toDataURL('image/jpeg', 0.92);
    this.closeModal();

    if (typeof this.onCropComplete === 'function') {
      this.onCropComplete(croppedBase64);
    }
  }
}

window.CropperManager = CropperManager;
