// Mock data storage
const storage = {
  users: new Map<string, any>(),
  sessions: new Map<string, any>(),
};

// Initialize with test user
const testUser = {
  email: 'maria.mueller@example.de',
  password: 'password123',
  vorname: 'Maria',
  nachname: 'Müller',
  telefon: '+49 151 1234567',
  adresse: {
    strasse: 'Musterstraße',
    hausnr: '12a',
    plz: '68161',
    ort: 'Mannheim',
    land: 'DE'
  },
  iban: 'DE89370400440532013000',
  bic: 'COBADEFFXXX',
  user_state: 'ACTIVE',
  role: 'USER',
  created_at: '2026-04-01T10:00:00+02:00'
};

storage.users.set(testUser.email, testUser);

// Helper functions
const generateToken = () => 'mock_' + Math.random().toString(36).substring(2, 15);

const getUserFromToken = (token: string | null) => {
  if (!token) return null;
  const session = storage.sessions.get(token);
  if (!session) return null;
  return storage.users.get(session.email);
};

export const mockAPI = {
  handleRequest: async (endpoint: string, method: string, body: any, token: string | null) => {
    // Auth endpoints
    if (endpoint === '/auth/register' && method === 'POST') {
      const { email, password, ...profile } = body;

      if (storage.users.has(email)) {
        throw { status: 409, code: 'ERR_CONFLICT', message: 'E-Mail bereits registriert' };
      }

      const user = {
        email,
        password,
        ...profile,
        user_state: 'ACTIVE',
        role: 'USER',
        created_at: new Date().toISOString()
      };

      storage.users.set(email, user);
      const accessToken = generateToken();
      const refreshToken = generateToken();
      storage.sessions.set(accessToken, { email, refreshToken });

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
    }

    if (endpoint === '/auth/login' && method === 'POST') {
      const { email, password } = body;
      const user = storage.users.get(email);

      if (!user || user.password !== password) {
        throw { status: 401, code: 'ERR_AUTH_INVALID', message: 'Ungültige Anmeldedaten' };
      }

      const accessToken = generateToken();
      const refreshToken = generateToken();
      storage.sessions.set(accessToken, { email, refreshToken });

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
    }

    if (endpoint === '/auth/refresh' && method === 'POST') {
      const { refreshToken } = body;
      const session = Array.from(storage.sessions.values()).find((s: any) => s.refreshToken === refreshToken);

      if (!session) {
        throw { status: 401, code: 'ERR_AUTH_EXPIRED', message: 'Refresh token ungültig' };
      }

      const user = storage.users.get(session.email);
      const newAccessToken = generateToken();
      const newRefreshToken = generateToken();
      storage.sessions.set(newAccessToken, { email: session.email, refreshToken: newRefreshToken });

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
    }

    // Profile endpoints (require auth)
    const user = getUserFromToken(token);
    if (!user) {
      throw { status: 401, code: 'ERR_AUTH_EXPIRED', message: 'Unauthorized' };
    }

    if (endpoint === '/users/me' && method === 'GET') {
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
    }

    if (endpoint === '/users/me' && method === 'PATCH') {
      Object.assign(user, body);
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
    }

    if (endpoint === '/users/me/refund-data' && method === 'GET') {
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
    }

    if (endpoint === '/users/me/bank' && method === 'PATCH') {
      user.iban = body.iban;
      user.bic = body.bic;
      return {
        status: 200,
        data: { iban: body.iban, bic: body.bic }
      };
    }

    if (endpoint === '/users/me' && method === 'DELETE') {
      // Simplified - just return success
      return {
        status: 204,
        data: {}
      };
    }

    throw { status: 404, code: 'ERR_NOT_FOUND', message: 'Endpoint not found' };
  }
};
