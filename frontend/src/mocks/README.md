# Mock Backend for RailBack User Forms

This directory contains a complete mock implementation of the RailBack API based on the `API_CONTRACT_USERFORMS.md` specification.

## Overview

The mock backend allows you to develop and test the frontend without waiting for the real backend. It implements all core endpoints defined in the API contract with realistic data and behavior.

## Files

- **`api.js`** - Core mock API implementation with in-memory storage
- **`client.js`** - API client wrapper with a clean interface for the frontend
- **`api-contract.md`** - Abbreviated version of the API contract

## Quick Start

### 1. Using the API Client

```javascript
import apiClient from './api/client';

// Login
const result = await apiClient.login('maria.mueller@example.de', 'password123');
console.log(result.user);

// Get user profile
const profile = await apiClient.getProfile();

// Get tickets
const tickets = await apiClient.getTickets();
```

### 2. Using with React Context

```javascript
import { AuthProvider, useAuth } from './contexts/AuthContext';

function App() {
  return (
    <AuthProvider>
      <YourApp />
    </AuthProvider>
  );
}

function YourComponent() {
  const { user, login, logout } = useAuth();
  
  const handleLogin = async () => {
    await login('maria.mueller@example.de', 'password123');
  };
  
  return (
    <div>
      {user ? (
        <p>Welcome, {user.vorname}!</p>
      ) : (
        <button onClick={handleLogin}>Login</button>
      )}
    </div>
  );
}
```

## Default Mock Data

The mock comes pre-loaded with:

### Test User
- **Email:** `maria.mueller@example.de`
- **Password:** `password123`
- **Name:** Maria Müller
- **Phone:** +49 151 1234567
- **Address:** Musterstraße 12a, 68161 Mannheim
- **IBAN:** DE89370400440532013000
- **BIC:** COBADEFFXXX

### Sample Ticket
- **Route:** Mannheim Hbf → Karlsruhe Hbf
- **Date:** 2026-05-12
- **Train:** IC 2345
- **Price:** 29.90 €
- **Status:** PENDING_DB_PAYMENT
- **Expected Refund:** 29.90 €

## Implemented Endpoints

### Authentication
- ✅ `POST /auth/register` - Create new account
- ✅ `POST /auth/login` - Login with email/password
- ✅ `POST /auth/refresh` - Refresh access token
- ✅ Logout (client-side only, clears tokens)

### User Profile
- ✅ `GET /users/me` - Get user profile
- ✅ `PATCH /users/me` - Update profile
- ✅ `GET /users/me/refund-data` - Get refund data (includes bank details)
- ✅ `PATCH /users/me/bank` - Update IBAN/BIC
- ⏳ `DELETE /users/me` - Delete account (not implemented yet)

### Tickets
- ✅ `GET /users/me/tickets` - List all tickets
- ✅ `GET /users/me/tickets/{id}` - Get ticket details
- ✅ `POST /users/me/tickets/{id}/upload` - Request presigned upload URL
- ✅ `POST /users/me/tickets/{id}/upload-confirm` - Confirm upload (simulates extraction)
- ✅ `POST /users/me/tickets/{id}/delays` - Look up delay data
- ✅ `POST /users/me/tickets/{id}/refund` - Submit refund application
- ⏳ `DELETE /users/me/tickets/{id}` - Delete ticket (not implemented yet)

### Route Lookup
- ✅ `POST /users/me/tickets/route-lookup` - Find connections by route
- ✅ `POST /users/me/tickets/from-route` - Create ticket from route (no upload)

### Route Templates
- ✅ `GET /users/me/route-templates` - List saved routes
- ✅ `POST /users/me/route-templates` - Create template
- ⏳ `PATCH /users/me/route-templates/{id}` - Update template
- ⏳ `DELETE /users/me/route-templates/{id}` - Delete template

## Mock Behavior

### Asynchronous Operations

The mock simulates real-world async behavior:

1. **Upload Extraction** - After confirming an upload, extraction status changes from `PROCESSING` → `DONE` after 2 seconds
2. **Email Delivery** - After submitting a refund, email status changes from `SENT` → `DELIVERED` after 1 second

### Polling Pattern

For operations that require polling (extraction, email delivery):

```javascript
async function pollTicket(ticketId) {
  let attempts = 0;
  const maxAttempts = 30;
  
  while (attempts < maxAttempts) {
    const ticket = await apiClient.getTicket(ticketId);
    
    if (ticket.extraction_status === 'DONE') {
      return ticket;
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }
  
  throw new Error('Polling timeout');
}
```

### Error Handling

The mock returns proper error responses:

```javascript
try {
  await apiClient.login('wrong@email.com', 'wrong');
} catch (error) {
  // error = { status: 401, code: 'ERR_AUTH_INVALID', message: '...' }
  console.error(error.code, error.message);
}
```

## Creating Test Data

### Register a New User

```javascript
await apiClient.register({
  email: "test@example.de",
  password: "testpass123",
  vorname: "Test",
  nachname: "User",
  telefon: "+49 151 9999999",
  adresse: {
    strasse: "Teststraße",
    hausnr: "1",
    plz: "12345",
    ort: "Berlin",
    land: "DE"
  },
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  datenschutz_einwilligung: true,
  agb_akzeptiert: true
});
```

### Create a Ticket via Route Lookup

```javascript
// 1. Look up routes
const routes = await apiClient.routeLookup({
  fromStation: "Mannheim Hbf",
  toStation: "Berlin Hbf",
  date: "2026-06-25",
  timeWindow: { from: "10:00", to: "12:00" }
});

// 2. Pick a candidate
const candidate = routes.candidates[0];

// 3. Create ticket from route
const ticketId = apiClient.generateULID();
await apiClient.createFromRoute({
  ticketId,
  trainNr: candidate.trainNr,
  date: "2026-06-25",
  fromStation: "Mannheim Hbf",
  toStation: "Berlin Hbf",
  abfahrtszeit_plan: candidate.abfahrt_plan,
  ankunftszeit_plan: candidate.ankunft_plan,
  fahrkartennummer: "AB12345678",
  fahrkartenpreis: "89.90"
});
```

### Submit a Refund

```javascript
// Look up delays
const delays = await apiClient.lookupDelays(ticketId, {
  trainNr: "ICE 279",
  date: "2026-06-25",
  abreisebahnhof: "Mannheim Hbf",
  zielbahnhof: "Berlin Hbf"
});

// Submit refund
await apiClient.submitRefund(ticketId, {
  antragsgrund: ["VERSPAETUNG"],
  antragsart: delays.suggested_antragsart,
  fahrt: { /* trip details */ },
  fahrt_tatsaechlich: { /* actual trip */ },
  antragstellung_ort: "Mannheim",
  datenschutz_einwilligung: true,
  wahrheitserklaerung: true
});
```

## Switching to Real Backend

When the real backend is ready, simply change the flag in `client.js`:

```javascript
const USE_MOCK = false; // Set to false for real backend
const API_BASE_URL = 'https://api.railback.example/v1'; // Update with real URL
```

You'll need to implement real HTTP requests instead of mock calls:

```javascript
async realAPICall(endpoint, options) {
  const response = await fetch(`${this.baseURL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.getAccessToken()}`,
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw error;
  }
  
  return response.json();
}
```

## Limitations

Current limitations of the mock:

1. **No persistence** - All data is in-memory and resets on page reload
2. **No file upload** - S3 presigned POST simulation doesn't actually store files
3. **Simplified validation** - Some backend validations are not implemented
4. **No webhooks** - Email delivery status changes are simulated with setTimeout
5. **Single user per session** - No multi-tenancy support

## Development Tips

1. **Open DevTools** - Check console for API calls and responses
2. **Use React DevTools** - Inspect AuthContext state
3. **Test error cases** - Try invalid emails, expired tokens, etc.
4. **Monitor localStorage** - Tokens are stored there for persistence

## Next Steps

1. Build login/register pages using AuthContext
2. Create ticket upload wizard with file handling
3. Implement dashboard with ticket list (see `Dashboard.jsx` example)
4. Add profile editing page
5. Build route template management

## Support

For questions about the API contract, refer to the full `API_CONTRACT_USERFORMS.md` document.
