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

  // Antragsübersicht des angemeldeten Nutzers. Folgt dem Backend-Contract
  // (get-tickets → TicketSummary[]). Paginierung via opaque cursor.
  async getTickets(): Promise<TicketsResponse> {
    return this.request('/users/me/tickets', { headers: this.getHeaders() });
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

// Ein Antrag in der Dashboard-Übersicht. Shape 1:1 zum API-Contract
// (GET /users/me/tickets, API_CONTRACT_USERFORMS.md). `ticket_state` ist ein
// Wert der Backend-TicketState-Enum (siehe StatusChip).
export interface TicketSummary {
  ticketId: string;
  ticket_state: string;
  abreisedatum: string;      // YYYY-MM-DD
  abreisebahnhof: string;
  zielbahnhof: string;
  fahrkartenpreis: string;   // Dezimal als String ("29.90"), EUR implizit
  updated_at: string;        // ISO-8601 mit TZ
  // Erst ab ticket_state >= EMAIL_SENDING gesetzt; davor laut Contract weggelassen.
  antragsart?: string;
  erwartete_erstattung?: string;
  email_status?: string;
  submitted_at?: string;
}

// GET /users/me/tickets liefert { items: [...] } — keine Paginierung
// (typischer Nutzer < 20 Anträge).
export interface TicketsResponse {
  items: TicketSummary[];
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
