/**
 * Mock API Server for RailBack User Forms
 * Based on API_CONTRACT_USERFORMS.md
 */

// Mock storage
let mockStorage = {
  users: new Map(),
  tickets: new Map(),
  templates: new Map(),
  sessions: new Map()
};

// Helper to generate mock tokens
function generateMockToken() {
  return 'mock_' + Math.random().toString(36).substring(2, 15);
}

// Helper to generate ULID-like IDs
function generateULID() {
  return '01J9X' + Math.random().toString(36).substring(2, 15).toUpperCase();
}

// Mock user data
const mockUser = {
  email: "maria.mueller@example.de",
  password: "password123", // Plaintext for mock only
  vorname: "Maria",
  nachname: "Müller",
  telefon: "+49 151 1234567",
  adresse: {
    strasse: "Musterstraße",
    hausnr: "12a",
    plz: "68161",
    ort: "Mannheim",
    land: "DE"
  },
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  user_state: "ACTIVE",
  role: "USER",
  created_at: "2026-04-01T10:00:00+02:00"
};

// Initialize mock data
mockStorage.users.set(mockUser.email, mockUser);

// Mock ticket data
const mockTicket = {
  ticketId: "01J9X123456789",
  ticket_state: "PENDING_DB_PAYMENT",
  extraction_status: "DONE",
  extraction_method: "BARCODE",
  extraction_confidence: 1.0,
  barcode_uid: "118XYZ123456",
  email_status: "DELIVERED",
  email_failed_reason: null,
  fahrt: {
    abreisedatum: "2026-05-12",
    abreisebahnhof: "Mannheim Hbf",
    zielbahnhof: "Karlsruhe Hbf",
    abfahrtszeit_plan: "14:22",
    ankunftszeit_plan: "14:56",
    zugnummer_plan: "IC 2345",
    zugkategorie_plan: "IC",
    fahrkartennummer: "AB12345678",
    fahrkartenpreis: "29.90"
  },
  vorname_aus_ticket: "Maria",
  nachname_aus_ticket: "Müller",
  uploaded_at: "2026-06-11T18:04:00+02:00",
  submitted_at: "2026-06-11T19:00:00+02:00",
  antragsart: "ENTSCHAEDIGUNG_60_119",
  erwartete_erstattung: "29.90",
  service_fee_betrag: "0.00",
  updated_at: "2026-06-11T19:00:00+02:00"
};

mockStorage.tickets.set(mockTicket.ticketId, { ...mockTicket, userEmail: mockUser.email });

// API handlers
export const mockAPI = {
  baseURL: '/api/v1',

  // Authentication endpoints
  async register(data) {
    const { email, password, ...profile } = data;

    if (mockStorage.users.has(email)) {
      return {
        status: 409,
        data: { code: "ERR_CONFLICT", message: "E-Mail bereits registriert" }
      };
    }

    const user = {
      email,
      password,
      ...profile,
      user_state: "ACTIVE",
      role: "USER",
      created_at: new Date().toISOString()
    };

    mockStorage.users.set(email, user);
    const accessToken = generateMockToken();
    const refreshToken = generateMockToken();
    mockStorage.sessions.set(accessToken, { email, refreshToken });

    return {
      status: 201,
      data: {
        accessToken,
        refreshToken,
        expiresIn: 900,
        user: {
          email: user.email,
          vorname: user.vorname,
          nachname: user.nachname,
          role: user.role
        }
      }
    };
  },

  async login(email, password) {
    const user = mockStorage.users.get(email);

    if (!user || user.password !== password) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_INVALID", message: "Ungültige Anmeldedaten" }
      };
    }

    if (user.user_state === "SUSPENDED") {
      return {
        status: 403,
        data: {
          code: "ERR_FORBIDDEN",
          message: "Dein Konto wurde gesperrt",
          details: { user_state: "SUSPENDED", suspended_reason: "Administrative action" }
        }
      };
    }

    const accessToken = generateMockToken();
    const refreshToken = generateMockToken();
    mockStorage.sessions.set(accessToken, { email, refreshToken });

    return {
      status: 200,
      data: {
        accessToken,
        refreshToken,
        expiresIn: 900,
        user: {
          email: user.email,
          vorname: user.vorname,
          nachname: user.nachname,
          role: user.role
        }
      }
    };
  },

  async refresh(refreshToken) {
    const session = Array.from(mockStorage.sessions.values()).find(s => s.refreshToken === refreshToken);

    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Refresh token ungültig oder abgelaufen" }
      };
    }

    const user = mockStorage.users.get(session.email);
    const newAccessToken = generateMockToken();
    const newRefreshToken = generateMockToken();
    mockStorage.sessions.set(newAccessToken, { email: session.email, refreshToken: newRefreshToken });

    return {
      status: 200,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 900,
        user: {
          email: user.email,
          vorname: user.vorname,
          nachname: user.nachname,
          role: user.role
        }
      }
    };
  },

  // User profile endpoints
  async getProfile(accessToken) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    const user = mockStorage.users.get(session.email);
    return {
      status: 200,
      data: {
        email: user.email,
        vorname: user.vorname,
        nachname: user.nachname,
        telefon: user.telefon,
        adresse: user.adresse,
        user_state: user.user_state,
        created_at: user.created_at
      }
    };
  },

  async updateProfile(accessToken, updates) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    const user = mockStorage.users.get(session.email);
    Object.assign(user, updates);

    return {
      status: 200,
      data: {
        email: user.email,
        vorname: user.vorname,
        nachname: user.nachname,
        telefon: user.telefon,
        adresse: user.adresse,
        user_state: user.user_state,
        created_at: user.created_at
      }
    };
  },

  async getRefundData(accessToken) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    const user = mockStorage.users.get(session.email);
    return {
      status: 200,
      data: {
        vorname: user.vorname,
        nachname: user.nachname,
        email: user.email,
        telefon: user.telefon,
        adresse: user.adresse,
        iban: user.iban || null,
        bic: user.bic || null
      }
    };
  },

  async updateBankData(accessToken, { iban, bic }) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    const user = mockStorage.users.get(session.email);
    user.iban = iban;
    user.bic = bic;

    return {
      status: 200,
      data: { iban, bic }
    };
  },

  // Ticket endpoints
  async getTickets(accessToken) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    const userTickets = Array.from(mockStorage.tickets.values())
      .filter(t => t.userEmail === session.email)
      .map(t => ({
        ticketId: t.ticketId,
        ticket_state: t.ticket_state,
        abreisedatum: t.fahrt.abreisedatum,
        abreisebahnhof: t.fahrt.abreisebahnhof,
        zielbahnhof: t.fahrt.zielbahnhof,
        fahrkartenpreis: t.fahrt.fahrkartenpreis,
        antragsart: t.antragsart,
        erwartete_erstattung: t.erwartete_erstattung,
        email_status: t.email_status,
        submitted_at: t.submitted_at,
        updated_at: t.updated_at
      }));

    return {
      status: 200,
      data: { items: userTickets }
    };
  },

  async getTicket(accessToken, ticketId) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    const ticket = mockStorage.tickets.get(ticketId);
    if (!ticket || ticket.userEmail !== session.email) {
      return {
        status: 404,
        data: { code: "ERR_NOT_FOUND", message: "Ticket nicht gefunden" }
      };
    }

    return {
      status: 200,
      data: ticket
    };
  },

  async createUploadRequest(accessToken, ticketId, { filename, mimeType }) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    const s3_key = `raw/${session.email.split('@')[0]}/${ticketId}.${mimeType.split('/')[1]}`;

    return {
      status: 200,
      data: {
        ticketId,
        uploadUrl: "https://railback-storage.s3.eu-central-1.amazonaws.com/",
        s3_key,
        expiresIn: 300,
        fields: {
          key: s3_key,
          "Content-Type": mimeType,
          bucket: "railback-storage",
          "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
          "X-Amz-Credential": "mock-credential",
          "X-Amz-Date": new Date().toISOString(),
          Policy: "mock-policy",
          "X-Amz-Signature": "mock-signature"
        }
      }
    };
  },

  async confirmUpload(accessToken, ticketId, data) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    // Create new ticket in PROCESSING state
    const ticket = {
      ticketId,
      userEmail: session.email,
      ticket_state: "VALIDATING",
      extraction_status: "PROCESSING",
      uploaded_at: new Date().toISOString()
    };

    mockStorage.tickets.set(ticketId, ticket);

    // Simulate extraction completing after 2 seconds
    setTimeout(() => {
      const t = mockStorage.tickets.get(ticketId);
      if (t) {
        t.extraction_status = "DONE";
        t.extraction_method = "BARCODE";
        t.extraction_confidence = 1.0;
        t.barcode_uid = "118XYZ" + Math.random().toString(36).substring(2, 8).toUpperCase();
        t.ticket_state = "READY";
        t.fahrt = {
          abreisedatum: "2026-06-25",
          abreisebahnhof: "Mannheim Hbf",
          zielbahnhof: "Berlin Hbf",
          abfahrtszeit_plan: "10:30",
          ankunftszeit_plan: "16:45",
          zugnummer_plan: "ICE 279",
          zugkategorie_plan: "ICE",
          fahrkartennummer: "AB" + Math.random().toString(36).substring(2, 10).toUpperCase(),
          fahrkartenpreis: "89.90"
        };
        t.vorname_aus_ticket = mockStorage.users.get(session.email).vorname;
        t.nachname_aus_ticket = mockStorage.users.get(session.email).nachname;
      }
    }, 2000);

    return {
      status: 202,
      data: {
        ticketId,
        extraction_status: "PROCESSING"
      }
    };
  },

  async lookupDelays(accessToken, ticketId, data) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    return {
      status: 200,
      data: {
        trainNr: data.trainNr,
        date: data.date,
        segments: [
          {
            segId: "8000244-8003200",
            origin: data.abreisebahnhof,
            destination: data.zielbahnhof,
            delayMinutes: 75,
            reason: "Technische Störung am Zug",
            is_cancelled: false,
            abfahrtszeit_plan: "10:30",
            abfahrtszeit_tatsaechlich: "11:45",
            ankunftszeit_plan: "16:45",
            ankunftszeit_tatsaechlich: "18:00"
          }
        ],
        maxDelayMinutes: 75,
        any_cancelled: false,
        suggested_antragsart: "ENTSCHAEDIGUNG_60_119"
      }
    };
  },

  async submitRefund(accessToken, ticketId, data) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    const ticket = mockStorage.tickets.get(ticketId);
    if (!ticket || ticket.userEmail !== session.email) {
      return {
        status: 404,
        data: { code: "ERR_NOT_FOUND", message: "Ticket nicht gefunden" }
      };
    }

    if (ticket.ticket_state !== "READY") {
      return {
        status: 409,
        data: {
          code: "ERR_CONFLICT",
          message: "Ticket ist nicht bereit zum Absenden",
          details: { current_state: ticket.ticket_state }
        }
      };
    }

    // Update ticket with submission data
    Object.assign(ticket, {
      ...data,
      ticket_state: "EMAIL_SENDING",
      email_status: "SENT",
      submitted_at: new Date().toISOString(),
      erwartete_erstattung: data.antragsart === "ENTSCHAEDIGUNG_60_119"
        ? (parseFloat(ticket.fahrt.fahrkartenpreis) * 0.25).toFixed(2)
        : (parseFloat(ticket.fahrt.fahrkartenpreis) * 0.50).toFixed(2),
      service_fee_betrag: "0.00"
    });

    // Simulate email delivery after 1 second
    setTimeout(() => {
      const t = mockStorage.tickets.get(ticketId);
      if (t) {
        t.email_status = "DELIVERED";
        t.ticket_state = "PENDING_DB_PAYMENT";
      }
    }, 1000);

    return {
      status: 202,
      data: {
        ticketId,
        ticket_state: "EMAIL_SENDING",
        submitted_at: ticket.submitted_at,
        email_status: "SENT",
        erwartete_erstattung: ticket.erwartete_erstattung,
        service_fee_betrag: ticket.service_fee_betrag
      }
    };
  },

  async routeLookup(accessToken, data) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    return {
      status: 200,
      data: {
        candidates: [
          {
            trainNr: "ICE 279",
            zugkategorie: "ICE",
            abfahrt_plan: "10:30",
            ankunft_plan: "16:45",
            abfahrt_tatsaechlich: "11:45",
            ankunft_tatsaechlich: "18:00",
            delayMinutes: 75,
            any_cancelled: false,
            data_quality: "FULL"
          },
          {
            trainNr: "IC 2345",
            zugkategorie: "IC",
            abfahrt_plan: "12:22",
            ankunft_plan: "18:30",
            abfahrt_tatsaechlich: "13:30",
            ankunft_tatsaechlich: "19:38",
            delayMinutes: 68,
            any_cancelled: false,
            data_quality: "FULL"
          }
        ]
      }
    };
  },

  async createFromRoute(accessToken, data) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    const ticket = {
      ticketId: data.ticketId,
      userEmail: session.email,
      ticket_state: "READY",
      extraction_status: "DONE",
      extraction_method: "MANUAL_ROUTE",
      extraction_confidence: 0.0,
      fahrt: {
        abreisedatum: data.date,
        abreisebahnhof: data.fromStation,
        zielbahnhof: data.toStation,
        abfahrtszeit_plan: data.abfahrtszeit_plan,
        ankunftszeit_plan: data.ankunftszeit_plan,
        zugnummer_plan: data.trainNr,
        zugkategorie_plan: data.trainNr.split(' ')[0],
        fahrkartennummer: data.fahrkartennummer,
        fahrkartenpreis: data.fahrkartenpreis
      },
      is_zeitkarte: data.is_zeitkarte || false,
      uploaded_at: new Date().toISOString()
    };

    mockStorage.tickets.set(data.ticketId, ticket);

    return {
      status: 201,
      data: {
        ticketId: data.ticketId,
        ticket_state: "READY",
        extraction_method: "MANUAL_ROUTE",
        extraction_confidence: 0.0
      }
    };
  },

  // Route templates
  async getTemplates(accessToken) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    const userTemplates = Array.from(mockStorage.templates.values())
      .filter(t => t.userEmail === session.email);

    return {
      status: 200,
      data: { templates: userTemplates }
    };
  },

  async createTemplate(accessToken, data) {
    const session = mockStorage.sessions.get(accessToken);
    if (!session) {
      return {
        status: 401,
        data: { code: "ERR_AUTH_EXPIRED", message: "Unauthorized" }
      };
    }

    const template = {
      ...data,
      userEmail: session.email,
      fromEva: 8000244, // Mock EVA number
      toEva: 8003200,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    mockStorage.templates.set(data.templateId, template);

    return {
      status: 201,
      data: template
    };
  }
};

// Export for use in the app
export default mockAPI;
