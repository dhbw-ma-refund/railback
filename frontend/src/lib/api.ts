const BASE_URL = 'https://api.railback.example/v1';

interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

class ApiClient {
  private getHeaders(includeAuth: boolean = true): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (includeAuth) {
      const token = localStorage.getItem('accessToken');
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${BASE_URL}${endpoint}`, options);

    if (!response.ok) {
      const error: ApiError = await response.json();
      throw error;
    }

    if (response.status === 204) return {} as T;
    return response.json();
  }

  async register(data: RegisterRequest): Promise<AuthResponse> {
    return this.request('/auth/register', {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify(data),
    });
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    return this.request('/auth/login', {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({ email, password }),
    });
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    return this.request('/auth/refresh', {
      method: 'POST',
      headers: this.getHeaders(false),
      body: JSON.stringify({ refreshToken }),
    });
  }

  async getProfile(): Promise<UserProfile> {
    return this.request('/users/me', { headers: this.getHeaders() });
  }

  async updateProfile(data: Partial<UpdateProfileRequest>): Promise<UserProfile> {
    return this.request('/users/me', {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
  }

  async getRefundData(): Promise<RefundData> {
    return this.request('/users/me/refund-data', { headers: this.getHeaders() });
  }

  async updateBank(iban: string, bic: string): Promise<{ iban: string; bic: string }> {
    return this.request('/users/me/bank', {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ iban, bic }),
    });
  }

  async deleteAccount(confirmPassword: string): Promise<void> {
    return this.request('/users/me', {
      method: 'DELETE',
      headers: this.getHeaders(),
      body: JSON.stringify({ confirmPassword }),
    });
  }
}

export const api = new ApiClient();

export interface RegisterRequest {
  email: string;
  password: string;
  vorname: string;
  nachname: string;
  telefon: string;
  adresse: {
    strasse: string;
    hausnr: string;
    plz: string;
    ort: string;
    land: string;
  };
  iban?: string;
  bic?: string;
  datenschutz_einwilligung: boolean;
  agb_akzeptiert: boolean;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    email: string;
    vorname: string;
    nachname: string;
    role: string;
  };
}

export interface UserProfile {
  email: string;
  vorname: string;
  nachname: string;
  telefon: string;
  adresse: {
    strasse: string;
    hausnr: string;
    plz: string;
    ort: string;
    land: string;
  };
  user_state: string;
  created_at: string;
}

export interface RefundData {
  vorname: string;
  nachname: string;
  email: string;
  telefon: string;
  adresse: {
    strasse: string;
    hausnr: string;
    plz: string;
    ort: string;
    land: string;
  };
  iban: string | null;
  bic: string | null;
}

export interface UpdateProfileRequest {
  vorname?: string;
  nachname?: string;
  telefon?: string;
  adresse?: {
    strasse: string;
    hausnr: string;
    plz: string;
    ort: string;
    land: string;
  };
}
