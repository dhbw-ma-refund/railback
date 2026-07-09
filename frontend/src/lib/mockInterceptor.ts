import { mockAPI } from './mockAPI';

const USE_MOCK = true; // Set to false when real backend is ready

// Intercept fetch to use mock API
const originalFetch = window.fetch;

if (USE_MOCK) {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const apiBaseUrl = 'https://api.railback.example/v1';

    // Only intercept our API calls
    if (url.startsWith(apiBaseUrl)) {
      const endpoint = url.replace(apiBaseUrl, '');
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : null;
      const token = init?.headers ? (init.headers as Record<string, string>)['Authorization']?.replace('Bearer ', '') : null;

      try {
        const result = await mockAPI.handleRequest(endpoint, method, body, token);

        return new Response(JSON.stringify(result.data), {
          status: result.status,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error: any) {
        return new Response(JSON.stringify(error), {
          status: error.status || 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Pass through all other requests
    return originalFetch(input, init);
  };
}

export { USE_MOCK };
