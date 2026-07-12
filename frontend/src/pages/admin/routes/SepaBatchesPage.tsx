import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { ApiError } from '../services/api/errors';
import { sepaApi } from '../services/api/sepa';
import { SEPA_REPORT_MAX_BYTES, type SepaPendingBatch } from '../services/types/sepa';
import { fmtDateTime } from '../services/format/date';
import { fmtEUR } from '../services/format/money';
import { Button } from '../ui-library';
import { useToast } from '../ui/useToast';
import '../admin.css';
import './DetailPage.css';
import './SepaBatchesPage.css';

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rb-detail__field">
      <span className="rb-detail__label">{label}</span>
      <span className="rb-detail__value">{value ?? '—'}</span>
    </div>
  );
}

/**
 * Operator-only page for the SEPA queue:
 *   - Lists pending pain.008 batches (`ISSUED` mandates with an XML built
 *     but not yet submitted to the bank).
 *   - Presigned S3 download link per batch (TTL 300 s — the page refetches
 *     on demand rather than caching stale URLs).
 *   - `Mark submitted` action per batch (idempotent 200; repeat call
 *     returns the original `submitted_at`).
 *   - Report upload flow — presigned POST, then multipart-form to S3. The
 *     backend never receives the bytes.
 *
 * Bank operations are async and error surfaces matter: 409/404/5xx are all
 * mapped to explicit German copy rather than raw error messages.
 */
export function SepaBatchesPage() {
  const toast = useToast();
  const [batches, setBatches] = useState<SepaPendingBatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingBatchId, setMarkingBatchId] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function reload(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const res = await sepaApi.listPendingBatches(signal);
      setBatches(res.items);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      if (err instanceof ApiError) setError(err.message);
      else setError('Netzwerkfehler.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, []);

  async function onMarkSubmitted(batch: SepaPendingBatch) {
    const ok = window.confirm(
      `Batch ${batch.batchId} als eingereicht markieren? ` +
        `${batch.mandate_count} Mandate, Summe ${fmtEUR(batch.total_eur)}.`,
    );
    if (!ok) return;
    setMarkingBatchId(batch.batchId);
    try {
      const res = await sepaApi.markBatchSubmitted(batch.batchId);
      if (res.mandates_marked > 0) {
        toast.show(
          `Batch markiert: ${res.mandates_marked} Mandat(e) auf SUBMITTED gesetzt.`,
          'info',
        );
      } else {
        toast.show('Batch war bereits eingereicht — nichts geändert.', 'warn');
      }
      await reload();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 404) toast.show('Batch nicht gefunden oder ohne Mandate.', 'error');
        else toast.show(err.message, 'error');
      } else {
        toast.show('Batch-Aktion fehlgeschlagen.', 'error');
      }
    } finally {
      setMarkingBatchId(null);
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setUploadFile(f);
  }

  function clearUploadFile() {
    setUploadFile(null);
    const input = document.getElementById('rb-sepa-upload') as HTMLInputElement | null;
    if (input) input.value = '';
  }

  async function onUpload() {
    if (!uploadFile) return;
    if (uploadFile.size > SEPA_REPORT_MAX_BYTES) {
      toast.show(`Datei zu groß (max. ${SEPA_REPORT_MAX_BYTES / 1024 / 1024} MB).`, 'error');
      return;
    }
    const mime = uploadFile.type === 'text/xml' ? 'text/xml' : 'application/xml';
    setUploading(true);
    try {
      const envelope = await sepaApi.requestReportUpload({
        filename: uploadFile.name,
        content_type: mime,
        size_bytes: uploadFile.size,
      });
      const res = await sepaApi.uploadReportToS3(envelope, uploadFile);
      if (res.ok || res.status === 204) {
        toast.show('Report hochgeladen.', 'info');
        clearUploadFile();
      } else {
        toast.show(`Upload fehlgeschlagen (S3 ${res.status}).`, 'error');
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 400) toast.show(err.message, 'error');
        else toast.show(err.message, 'error');
      } else {
        toast.show('Upload fehlgeschlagen.', 'error');
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rb-detail">
      <h1 className="rb-detail__title">SEPA</h1>

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Offene pain.008-Batches</h2>
        {loading && <div>Lade …</div>}
        {error && <div className="rb-detail__error">{error}</div>}
        {!loading && !error && batches && batches.length === 0 && (
          <div>Keine offenen Batches. Alle Mandate sind entweder erledigt oder noch nicht gebaut.</div>
        )}
        {!loading && !error && batches && batches.length > 0 && (
          <ul className="rb-detail__ticket-list">
            {batches.map((batch) => (
              <li key={batch.batchId} className="rb-detail__ticket rb-sepa-batch">
                <div className="rb-detail__grid">
                  <Field label="Batch" value={batch.batchId} />
                  <Field label="Mandate" value={batch.mandate_count} />
                  <Field label="Summe" value={fmtEUR(batch.total_eur)} />
                  <Field label="Gebaut am" value={fmtDateTime(batch.built_at)} />
                </div>
                <div className="rb-sepa-batch__actions">
                  <a
                    className="rb-button rb-button--secondary rb-button--medium"
                    href={batch.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    pain.008 XML herunterladen
                  </a>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={markingBatchId === batch.batchId}
                    onClick={() => onMarkSubmitted(batch)}
                  >
                    {markingBatchId === batch.batchId ? 'Läuft …' : 'Als eingereicht markieren'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rb-detail__section">
        <h2 className="rb-detail__section-title">Bank-Report hochladen</h2>
        <div className="rb-sepa-upload">
          <p className="rb-sepa-upload__helper">
            pain.008-XML von der Hausbank (max. {SEPA_REPORT_MAX_BYTES / 1024 / 1024} MB).
          </p>
          <div className="rb-sepa-upload__row">
            <label className="rb-button rb-button--secondary rb-button--medium rb-sepa-upload__trigger">
              <input
                id="rb-sepa-upload"
                className="rb-sepa-upload__native"
                type="file"
                accept=".xml,application/xml,text/xml"
                onChange={onFileChange}
                disabled={uploading}
              />
              Datei auswählen
            </label>
            {uploadFile && (
              <span className="rb-sepa-upload__chip">
                <span className="rb-sepa-upload__chip-name" title={uploadFile.name}>
                  {uploadFile.name}
                </span>
                <button
                  type="button"
                  className="rb-sepa-upload__chip-clear"
                  onClick={clearUploadFile}
                  aria-label="Datei entfernen"
                  disabled={uploading}
                >
                  ×
                </button>
              </span>
            )}
            <Button
              type="button"
              variant="primary"
              disabled={!uploadFile || uploading}
              onClick={onUpload}
            >
              {uploading ? 'Läuft …' : 'Hochladen'}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
