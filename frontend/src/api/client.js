/**
 * API Client for RailBack User Forms
 * Wraps the mock API with a clean interface for the frontend
 */

import mockAPI from '../mocks/api.js';

const USE_MOCK = true; // Set to false when real backend is ready
const API_BASE_URL = USE_MOCK ? '/api/v1' : 'https://api.railback.example/v1';

class APIClient {
  constructor() {
    this.baseURL = API_BASE_URL;
    this.accessToken = null;
    this.refreshToken = null;
  }

  setTokens(accessToken, refreshToken) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    if (accessToken) {
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
    } else {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
  }

  getAccessToken() {
    if (!this.accessToken) {
      this.accessToken = localStorage.getItem('accessToken');
    }
    return this.accessToken;
  }

  getRefreshToken() {
    if (!this.refreshToken) {
      this.refreshToken = localStorage.getItem('refreshToken');
    }
    return this.refreshToken;
  }

  clearTokens() {
    this.setTokens(null, null);
  }

  // Mock API call wrapper
  async mockCall(handler) {
    if (!USE_MOCK) {
      throw new Error('Mock API disabled');
    }

    const result = await handler();

    if (result.status >= 400) {
      throw {
        status: result.status,
        ...result.data
      };
    }

    return result.data;
  }

  // Authentication
  async register(data) {
    const result = await this.mockCall(() => mockAPI.register(data));
    this.setTokens(result.accessToken, result.refreshToken);
    return result;
  }

  async login(email, password) {
    const result = await this.mockCall(() => mockAPI.login(email, password));
    this.setTokens(result.accessToken, result.refreshToken);
    return result;
  }

  async refresh() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const result = await this.mockCall(() => mockAPI.refresh(refreshToken));
    this.setTokens(result.accessToken, result.refreshToken);
    return result;
  }

  logout() {
    this.clearTokens();
  }

  // User profile
  async getProfile() {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.getProfile(token));
  }

  async updateProfile(updates) {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.updateProfile(token, updates));
  }

  async getRefundData() {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.getRefundData(token));
  }

  async updateBankData(iban, bic) {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.updateBankData(token, { iban, bic }));
  }

  async deleteAccount(confirmPassword) {
    const token = this.getAccessToken();
    // Mock doesn't implement this yet
    throw new Error('Not implemented in mock');
  }

  // Tickets
  async getTickets() {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.getTickets(token));
  }

  async getTicket(ticketId) {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.getTicket(token, ticketId));
  }

  async createUploadRequest(ticketId, filename, mimeType) {
    const token = this.getAccessToken();
    return await this.mockCall(() =>
      mockAPI.createUploadRequest(token, ticketId, { filename, mimeType })
    );
  }

  async confirmUpload(ticketId, s3_key, filename, mimeType) {
    const token = this.getAccessToken();
    return await this.mockCall(() =>
      mockAPI.confirmUpload(token, ticketId, { s3_key, filename, mimeType })
    );
  }

  async lookupDelays(ticketId, data) {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.lookupDelays(token, ticketId, data));
  }

  async submitRefund(ticketId, data) {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.submitRefund(token, ticketId, data));
  }

  async deleteTicket(ticketId) {
    const token = this.getAccessToken();
    // Mock doesn't implement this yet
    throw new Error('Not implemented in mock');
  }

  // Route lookup
  async routeLookup(data) {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.routeLookup(token, data));
  }

  async createFromRoute(data) {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.createFromRoute(token, data));
  }

  // Route templates
  async getTemplates() {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.getTemplates(token));
  }

  async createTemplate(data) {
    const token = this.getAccessToken();
    return await this.mockCall(() => mockAPI.createTemplate(token, data));
  }

  async updateTemplate(templateId, updates) {
    const token = this.getAccessToken();
    // Mock doesn't implement this yet
    throw new Error('Not implemented in mock');
  }

  async deleteTemplate(templateId) {
    const token = this.getAccessToken();
    // Mock doesn't implement this yet
    throw new Error('Not implemented in mock');
  }

  // Helper to generate ULID
  generateULID() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const randomPart = Math.random().toString(36).substring(2, 15).toUpperCase();
    return '01J9X' + timestamp + randomPart;
  }
}

// Export singleton instance
export const apiClient = new APIClient();
export default apiClient;
