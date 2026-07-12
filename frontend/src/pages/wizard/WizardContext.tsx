import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

/**
 * Wizard state shape. Every field maps to something in the backend contract:
 *
 * - `mode` — the UX entry path the user chose; not sent to the backend.
 * - `ticketFile` — display-only stand-in for the upload; backend uses presigned S3 POST.
 * - `fahrt` — populates `RefundRequest.fahrt` (all Pflicht fields at submit).
 * - `problem.antragsgrund` — populates `RefundRequest.antragsgrund` (≥1 tag).
 * - `problem.verpasster_anschluss_bahnhof` → `RefundRequest.fahrt_tatsaechlich.verpasster_anschluss_bahnhof`.
 * - `person` — mirror of user profile; edits fire `PATCH /users/me` before submit. Not on ticket.
 *   `kundennummer` is UI-only (backend has no such field yet).
 * - `auszahlung` — mirror of `GET /users/me/refund-data`; edits fire `PATCH /users/me/bank`.
 *   Snapshotted onto the SEPA mandate at submit; not on the ticket.
 * - `antragstellung_ort` / consent literals — sent inline on `POST /refund`.
 */

export type WizardMode = 'upload' | 'lookup' | 'manual';

export type AntragsgrundTag = 'REISEABBRUCH' | 'REISEUNTERBRECHUNG' | 'VERPASSTER_ANSCHLUSS' | 'LETZTER_UMSTIEG';

export interface FahrtFields {
  abreisebahnhof: string;
  abfahrtszeit_plan: string;    // HH:MM
  zielbahnhof: string;
  ankunftszeit_plan: string;    // HH:MM
  abreisedatum: string;         // YYYY-MM-DD
  zugnummer_plan: string;
  fahrkartennummer: string;
  fahrkartenpreis: string;      // decimal EUR, e.g. "29.90"
}

export interface WizardState {
  mode: WizardMode | null;
  ticketFile: { name: string; sizeBytes: number; mimeType: string } | null;
  fahrt: Partial<FahrtFields>;
  problem: {
    antragsgrund: AntragsgrundTag[];
    reiseabbruch_bahnhof?: string;
    reiseunterbrechung_bahnhof?: string;
    verpasster_anschluss_bahnhof?: string;
    letzter_umstieg_bahnhof?: string;
  };
  person: {
    vorname: string;
    nachname: string;
    email: string;
    telefon?: string;
    kundennummer?: string;      // UI-only; not in backend contract yet
  };
  auszahlung: {
    kontoinhaber: string;
    iban: string;
    bic: string;
  };
  antragstellung_ort: string;
  datenschutz_einwilligung: boolean;
  wahrheitserklaerung: boolean;
}

const INITIAL_STATE: WizardState = {
  mode: null,
  ticketFile: null,
  fahrt: {},
  problem: { antragsgrund: [] },
  person: { vorname: '', nachname: '', email: '' },
  auszahlung: { kontoinhaber: '', iban: '', bic: '' },
  antragstellung_ort: '',
  datenschutz_einwilligung: false,
  wahrheitserklaerung: false,
};

interface WizardContextValue {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  updateFahrt: (patch: Partial<FahrtFields>) => void;
  updatePerson: (patch: Partial<WizardState['person']>) => void;
  updateAuszahlung: (patch: Partial<WizardState['auszahlung']>) => void;
  reset: () => void;
}

const WizardContext = createContext<WizardContextValue | undefined>(undefined);

const STORAGE_KEY = 'railback.wizard.v1';

export const WizardProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<WizardState>(() => {
    // localStorage-backed so refresh mid-wizard doesn't destroy progress.
    // Version key (`v1`) lets us bust the cache when the shape changes.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...INITIAL_STATE, ...JSON.parse(raw) };
    } catch {
      // fall through
    }
    return INITIAL_STATE;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore quota errors — wizard still works in memory
    }
  }, [state]);

  const update: WizardContextValue['update'] = (patch) =>
    setState((s) => ({ ...s, ...patch }));

  const updateFahrt: WizardContextValue['updateFahrt'] = (patch) =>
    setState((s) => ({ ...s, fahrt: { ...s.fahrt, ...patch } }));

  const updatePerson: WizardContextValue['updatePerson'] = (patch) =>
    setState((s) => ({ ...s, person: { ...s.person, ...patch } }));

  const updateAuszahlung: WizardContextValue['updateAuszahlung'] = (patch) =>
    setState((s) => ({ ...s, auszahlung: { ...s.auszahlung, ...patch } }));

  const reset = () => {
    setState(INITIAL_STATE);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <WizardContext.Provider value={{ state, update, updateFahrt, updatePerson, updateAuszahlung, reset }}>
      {children}
    </WizardContext.Provider>
  );
};

export const useWizard = () => {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used within WizardProvider');
  return ctx;
};

// Step registry — single source of truth for footer nav order + labels + slugs.
export interface WizardStep {
  slug: string;
  path: string;
  labelDe: string;
  shortDe: string;
  index: number; // 1-based; displayed in the footer chip
}

export const WIZARD_STEPS: WizardStep[] = [
  { slug: 'upload',     path: '/antrag/neu/upload',     labelDe: 'Ticket hochladen',       shortDe: 'Hoch-\nladen',       index: 1 },
  { slug: 'reise',      path: '/antrag/neu/reise',      labelDe: 'Reisedaten prüfen',      shortDe: 'Reise-\ndaten',      index: 2 },
  { slug: 'problem',    path: '/antrag/neu/problem',    labelDe: 'Verspätung oder Problem', shortDe: 'Problem\nangeben',   index: 3 },
  { slug: 'person',     path: '/antrag/neu/person',     labelDe: 'Persönliche Daten',      shortDe: 'Pers.\nDaten',       index: 4 },
  { slug: 'auszahlung', path: '/antrag/neu/auszahlung', labelDe: 'Auszahlung',             shortDe: 'Aus-\nzahlung',      index: 5 },
  { slug: 'pruefen',    path: '/antrag/neu/pruefen',    labelDe: 'Bitte prüfen',           shortDe: 'Prüfen',             index: 6 },
];

export const stepBySlug = (slug: string) => WIZARD_STEPS.find((s) => s.slug === slug);
