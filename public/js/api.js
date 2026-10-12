/**
 * Sadaneera Mahotsav - Client API Service
 * Handles authenticated HTTP requests to Express backend
 */

const API = {
  TOKEN_KEY: 'sadaneera_auth_token',
  USER_KEY: 'sadaneera_user',

  getToken() {
    const t = localStorage.getItem(this.TOKEN_KEY);
    if (!t || t === 'undefined' || t === 'null' || t.trim() === '') {
      return null;
    }
    return t;
  },

  setSession(token, user) {
    if (token && user) {
      localStorage.setItem(this.TOKEN_KEY, token);
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    }
  },

  clearSession() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  },

  getCurrentUser() {
    const raw = localStorage.getItem(this.USER_KEY);
    try {
      const u = raw ? JSON.parse(raw) : null;
      if (!u || typeof u !== 'object' || !u.id) return null;
      return u;
    } catch {
      return null;
    }
  },

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = options.headers || {};

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Default to JSON if not FormData
    if (!(options.body instanceof FormData) && !headers['Content-Type'] && options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeoutMs = options.timeout || 10000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        ...options,
        headers,
        signal: options.signal || controller.signal
      });
      clearTimeout(timeoutId);

      let data;
      const rawText = await res.text().catch(() => '');
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = { success: false, message: rawText ? rawText.slice(0, 150) : 'Server returned non-JSON response' };
      }

      // Only dispatch auth:expired for active authenticated endpoints during user activity
      // Do NOT dispatch on /api/auth/login (bad credentials) or initial /api/auth/me verification
      if (token && endpoint !== '/api/auth/login' && endpoint !== '/api/auth/me') {
        if (res.status === 401 || (res.status === 403 && data.message && (data.message.includes('expired') || data.message.includes('deactivated') || data.message.includes('token')))) {
          window.dispatchEvent(new CustomEvent('auth:expired', { detail: data.message }));
        }
      }

      if (!res.ok) {
        throw new Error(data.message || `Request failed with status ${res.status}`);
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
      }
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
  },

  // Auth Endpoints
  async login(username, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (data.success && data.token) {
      this.setSession(data.token, data.user);
    }
    return data;
  },

  async getMe() {
    return this.request('/api/auth/me');
  },

  async logout() {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      // Ignore network issues during logout
    } finally {
      this.clearSession();
    }
  },

  // Admin Management Endpoints (Super Admin Only)
  async getAdmins() {
    return this.request('/api/admins');
  },

  async createAdmin(adminData) {
    return this.request('/api/admins', {
      method: 'POST',
      body: JSON.stringify(adminData)
    });
  },

  async toggleAdminStatus(id) {
    return this.request(`/api/admins/${id}/toggle-status`, {
      method: 'PATCH'
    });
  },

  async deleteAdmin(id) {
    return this.request(`/api/admins/${id}`, {
      method: 'DELETE'
    });
  },

  async resetAllCards(password, confirmation) {
    return this.request('/api/admins/reset-cards', {
      method: 'POST',
      body: JSON.stringify({ password, confirmation })
    });
  },

  // Card Management Endpoints
  async createCard(cardPayload) {
    return this.request('/api/cards', {
      method: 'POST',
      body: JSON.stringify(cardPayload)
    });
  },

  async getCards(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/cards${query ? '?' + query : ''}`);
  },

  async getCardById(id) {
    return this.request(`/api/cards/${id}`);
  },

  async deleteCard(id) {
    return this.request(`/api/cards/${id}`, {
      method: 'DELETE'
    });
  },

  // Dashboard Stats
  async getDashboardStats() {
    return this.request('/api/stats/dashboard');
  },

  // Card Content Settings (Super Admin Only)
  async getCardContentSettings() {
    return this.request('/api/settings/card-content');
  },

  async updateCardContentSettings(settings) {
    return this.request('/api/settings/card-content', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  }
};

window.API = API;
