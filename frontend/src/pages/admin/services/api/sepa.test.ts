import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sepaApi } from './sepa';
import { clearTokens, setTokens } from '../auth/storage';
import { ApiError } from './errors';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const BATCH_RAW = {
  batchId: '01J-BATCH-01',
  s3_key: 'pain008/2026-07-12/01J-BATCH-01.xml',
  downloadUrl: 'https://s3.example/presigned',
  downloadUrlExpiresIn: 300,
  mandate_count: 3,
  total_eur: '2.25',
  built_at: '2026-07-12T09:14:00.000Z',
};

describe('sepaApi.listPendingBatches', () => {
  beforeEach(() => {
    clearTokens();
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('parses items with money as string decimals', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { items: [BATCH_RAW] }));
    const res = await sepaApi.listPendingBatches();
    expect(res.items).toHaveLength(1);
    expect(res.items[0].batchId).toBe('01J-BATCH-01');
    expect(res.items[0].total_eur).toBe('2.25');
    expect(res.items[0].mandate_count).toBe(3);
    expect(res.items[0].downloadUrlExpiresIn).toBe(300);
  });

  it('drops items missing a batchId (contract drift)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { items: [BATCH_RAW, { total_eur: '1.00' }] }),
    );
    const res = await sepaApi.listPendingBatches();
    expect(res.items).toHaveLength(1);
    expect(res.items[0].batchId).toBe('01J-BATCH-01');
  });

  it('returns empty items on an empty queue', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    const res = await sepaApi.listPendingBatches();
    expect(res.items).toHaveLength(0);
  });
});

describe('sepaApi.markBatchSubmitted', () => {
  beforeEach(() => {
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('hits /admin/sepa/batches/{id}/mark-submitted with empty body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        batchId: '01J-BATCH-01',
        submitted_at: '2026-07-12T10:00:00.000Z',
        mandates_marked: 3,
      }),
    );
    const res = await sepaApi.markBatchSubmitted('01J-BATCH-01');
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/admin/sepa/batches/01J-BATCH-01/mark-submitted');
    expect(url).not.toContain('pending-batches');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(res.mandates_marked).toBe(3);
    expect(res.submitted_at).toBe('2026-07-12T10:00:00.000Z');
  });

  it('reports 0 mandates_marked on a repeat call (idempotent)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        batchId: '01J-BATCH-01',
        submitted_at: '2026-07-12T10:00:00.000Z',
        mandates_marked: 0,
      }),
    );
    const res = await sepaApi.markBatchSubmitted('01J-BATCH-01');
    expect(res.mandates_marked).toBe(0);
  });

  it('surfaces 404 as ApiError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(404, { error: { code: 'ERR_NOT_FOUND', message: 'batch not found' } }),
    );
    await expect(sepaApi.markBatchSubmitted('nope')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('sepaApi.requestReportUpload', () => {
  beforeEach(() => {
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('POSTs the JSON body and parses url + fields', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        url: 'https://s3.example/',
        fields: { key: 'sepa-reports/x.xml', 'Content-Type': 'application/xml' },
        expires_in: 300,
      }),
    );
    const res = await sepaApi.requestReportUpload({
      filename: 'x.xml',
      content_type: 'application/xml',
      size_bytes: 100,
    });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({ filename: 'x.xml', content_type: 'application/xml', size_bytes: 100 }),
    );
    expect(res.url).toBe('https://s3.example/');
    expect(res.fields.key).toBe('sepa-reports/x.xml');
  });

  it('drops non-string entries from fields', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        url: 'https://s3.example/',
        // A malformed policy field lands as number; must be filtered.
        fields: { key: 'ok', bogus: 42 },
        expires_in: 300,
      }),
    );
    const res = await sepaApi.requestReportUpload({
      filename: 'x.xml',
      content_type: 'application/xml',
      size_bytes: 100,
    });
    expect(res.fields.key).toBe('ok');
    expect('bogus' in res.fields).toBe(false);
  });
});

describe('sepaApi.rebuildPain008', () => {
  beforeEach(() => {
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('POSTs to /admin/tickets/{id}/pain008-rebuild with empty body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        ticketId: 'T1',
        mandate_id: 'MND-1',
        pain008_batch_id: 'B1',
        pain008_built_at: '2026-07-12T10:05:00.000Z',
        pain008_s3_key: 'pain008/2026-07-12/B1.xml',
      }),
    );
    const res = await sepaApi.rebuildPain008('T1');
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/admin/tickets/T1/pain008-rebuild');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(res.mandate_id).toBe('MND-1');
    expect(res.pain008_batch_id).toBe('B1');
  });

  it('URL-encodes the ticket id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        ticketId: 'T/1',
        mandate_id: '',
        pain008_batch_id: '',
        pain008_built_at: '',
        pain008_s3_key: '',
      }),
    );
    await sepaApi.rebuildPain008('T/1');
    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/admin/tickets/T%2F1/pain008-rebuild');
  });

  it('surfaces 409 with details.from as ApiError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(409, {
        error: {
          code: 'ERR_CONFLICT',
          message: 'wrong state',
          details: { from: 'VALIDATING' },
        },
      }),
    );
    await expect(sepaApi.rebuildPain008('T1')).rejects.toMatchObject({
      status: 409,
      body: { code: 'ERR_CONFLICT', details: { from: 'VALIDATING' } },
    });
  });
});

describe('sepaApi.uploadReportToS3', () => {
  beforeEach(() => {
    setTokens('a', 'r', 9999);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('appends every policy field before the file and posts to the presigned URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const envelope = {
      url: 'https://s3.example/',
      fields: { key: 'sepa-reports/x.xml', policy: 'p', 'X-Amz-Signature': 's' },
      expires_in: 300,
    };
    const file = new File(['<xml/>'], 'x.xml', { type: 'application/xml' });
    const res = await sepaApi.uploadReportToS3(envelope, file);
    expect(res.status).toBe(204);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://s3.example/');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    // Order matters for S3: policy fields first, `file` last.
    const keys = Array.from(form.keys());
    expect(keys[keys.length - 1]).toBe('file');
    expect(form.get('key')).toBe('sepa-reports/x.xml');
    expect(form.get('policy')).toBe('p');
    expect(form.get('X-Amz-Signature')).toBe('s');
  });
});
