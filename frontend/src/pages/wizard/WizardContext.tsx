import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { api } from '../../lib/api';
import type {
  Antragsart,
  DelaysResponse,
  RefundResponse,
} from '../../lib/api';

/**
 * Wizard state shape. Every field maps to something in the backend contract:
 *
 * - `mode` — the UX entry path the user chose; not sent to the backend.
 * - `ticketId` — populated once the backend has assigned/received it
 *   (POST /upload or POST /from-route). ReviewStep may create it late on
 *   the manual/lookup paths; UploadStep creates it early on the upload path.
 * - `ticketFile` — display-only metadata about the uploaded file.
 * - `fahrt` — populates `RefundRequest.fahrt` at submit.
 * - `problem.antragsgrund` — UI tags; mapped to backend `ANTRAGSGRUENDE`
 *   in buildRefundBody.
 * - `person` — mirror of user profile; prefilled from /users/me/refund-data.
 *   `kundennummer` is UI-only (no backend field).
 * - `auszahlung` — mirror of iban+bic; prefilled from refund-data. Edits
 *   go to /users/me/bank once at submit if the values differ from the
 *   hydrated snapshot.
 * - `antragsart` — chosen at review time (defaults to ENTSCHAEDIGUNG_60_119
 *   or the delay-lookup suggestion).
 * - `belege` — client-side list of belege staged for KOSTEN_ALTERNATIVTRANSPORT.
 * - `delayLookup` — cached response from POST /delays for review + suggestion.
 * - `submitResult` — cached response from POST /refund for SubmittedStep.
 * - `antragstellung_ort` / consent literals — sent inline on POST /refund.
 */

export type WizardMode = 'upload' | 'lookup' | 'manual';

/**
 * Backend antragsgrund enum values used verbatim in wizard state.
 * Historically the wizard used 4 poetic UI tags that had to be mapped
 * to the 3 backend values at submit — but that lost the plainest case
 * ("my train was late") and one of the 4 mapped to AUSFALL (a
 * different legal category). We now display the 3 backend cases
 * directly.
 */
export type AntragsgrundTag = 'VERSPAETUNG' | 'AUSFALL' | 'VERPASSTER_ANSCHLUSS';

export interface FahrtFields {
  abreisebahnhof: string;
  abfahrtszeit_plan: string; // HH:MM
  zielbahnhof: string;
  ankunftszeit_plan: string; // HH:MM
  abreisedatum: string; // YYYY-MM-DD
  zugnummer_plan: string;
  zugkategorie_plan: string;
  fahrkartennummer: string;
  fahrkartenpreis: string; // decimal EUR, e.g. "29.90"
}

export interface BelegDraft {
  /** Local-only id for React keys; the server-side belegId lands after upload. */
  localId: string;
  belegId?: string;
  filename?: string;
  mimeType?: 'application/pdf' | 'image/jpeg' | 'image/png';
  size_bytes?: number;
  typ: 'TAXI' | 'BUS' | 'HOTEL' | 'SONSTIGES';
  amount: string; // decimal EUR
  file?: File;
  status: 'draft' | 'uploading' | 'uploaded' | 'error';
  error?: string;
}

export interface WizardState {
  mode: WizardMode | null;
  ticketId: string | null;
  ticketFile: { name: string; sizeBytes: number; mimeType: string } | null;
  fahrt: Partial<FahrtFields>;
  problem: {
    antragsgrund: AntragsgrundTag[];
    /** Populated when antragsgrund includes VERPASSTER_ANSCHLUSS — backend requires it. */
    verpasster_anschluss_bahnhof?: string;
  };
  person: {
    vorname: string;
    nachname: string;
    email: string;
    telefon?: string;
    kundennummer?: string; // UI-only; not in backend contract
  };
  /** Snapshot of person/auszahlung at hydration — used to detect dirty edits. */
  hydrated: {
    person?: {
      vorname: string;
      nachname: string;
      email: string;
      telefon: string;
    };
    auszahlung?: {
      iban: string;
      bic: string;
    };
  };
  auszahlung: {
    kontoinhaber: string;
    iban: string;
    bic: string;
  };
  antragsart: Antragsart | null;
  is_zeitkarte: boolean;
  belege: BelegDraft[];
  /**
   * `templateId` when the user picked an existing template from the
   * FahrtStep / LookupStep chip picker. Forwarded to /from-route so the
   * backend can link the resulting ticket to the template (currently
   * informational on the wire — see the note on
   * FromRouteRequest.templateId). Reset when the user manually edits
   * either station.
   */
  pickedTemplateId: string | null;
  /**
   * When the user ticks "Als Strecke speichern" during the current
   * wizard session, we POST the template immediately and pin the
   * created row here. Untick → DELETE and clear. We store the
   * from/to alongside the id so downstream steps can tell whether the
   * pointer still describes the fields currently shown in the form:
   *
   *   isSavedNow = savedThisSession &&
   *                savedThisSession.fromStation === fahrt.abreisebahnhof &&
   *                savedThisSession.toStation   === fahrt.zielbahnhof
   *
   * If the user edits either station after saving, the pointer no
   * longer matches — the checkbox reads unchecked and offers to save
   * the NEW route — but the original template stays on the account
   * (untick can't accidentally delete it because the checkbox is not
   * checked). If they navigate to a different wizard step (Lookup vs
   * Fahrt) with different from/to values, same rule applies.
   *
   * NOTE: only set for templates saved DURING this wizard session.
   * Templates the user saved in previous sessions live only in the
   * shared useRouteTemplates cache; they can be deleted from the
   * Profile page.
   */
  savedThisSession: {
    templateId: string;
    fromStation: string;
    toStation: string;
  } | null;
  delayLookup: DelaysResponse | null;
  submitResult: RefundResponse | null;
  antragstellung_ort: string;
  zusaetzliche_angaben: string;
  datenschutz_einwilligung: boolean;
  wahrheitserklaerung: boolean;
}

const INITIAL_STATE: WizardState = {
  mode: null,
  ticketId: null,
  ticketFile: null,
  fahrt: {},
  problem: { antragsgrund: ['VERSPAETUNG'] },
  person: { vorname: '', nachname: '', email: '' },
  hydrated: {},
  auszahlung: { kontoinhaber: '', iban: '', bic: '' },
  antragsart: null,
  is_zeitkarte: false,
  belege: [],
  pickedTemplateId: null,
  savedThisSession: null,
  delayLookup: null,
  submitResult: null,
  antragstellung_ort: '',
  zusaetzliche_angaben: '',
  datenschutz_einwilligung: false,
  wahrheitserklaerung: false,
};

interface WizardContextValue {
  state: WizardState;
  hydrating: boolean;
  update: (patch: Partial<WizardState>) => void;
  updateFahrt: (patch: Partial<FahrtFields>) => void;
  updatePerson: (patch: Partial<WizardState['person']>) => void;
  updateAuszahlung: (patch: Partial<WizardState['auszahlung']>) => void;
  /** Full reset — after successful submit or user-initiated cancel. */
  reset: () => void;
  /**
   * Reset only the ticket-scoped slices (fahrt, problem, ticket ids,
   * belege, submit result, consents). Prefilled person/auszahlung and
   * their hydrated snapshot survive so a repeat wizard entry doesn't
   * re-fetch or lose typing.
   */
  resetTicket: () => void;
}

const WizardContext = createContext<WizardContextValue | undefined>(undefined);

const STORAGE_KEY = 'railback.wizard.v7';
// Bumped from v6 → v7: savedThisSessionTemplateId (string | null) was
// replaced by savedThisSession ({templateId, fromStation, toStation} |
// null) to fix a data-loss bug where editing the stations after
// ticking "Als Strecke speichern" and then unticking would DELETE the
// wrong (but still-valid) saved template. Old v6 blobs would carry
// the dead key; bumping is defensive.

export const WizardProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<WizardState>(() => {
    // localStorage-backed so refresh mid-wizard doesn't destroy progress.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...INITIAL_STATE, ...JSON.parse(raw) };
    } catch {
      // fall through
    }
    return INITIAL_STATE;
  });

  const [hydrating, setHydrating] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    try {
      // File instances aren't JSON-serialisable; strip them before persisting
      // (the object metadata stays so the UI can still show "3 Belege staged").
      const persistable = {
        ...state,
        belege: state.belege.map((b) => ({ ...b, file: undefined })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    } catch {
      // ignore quota errors — wizard still works in memory
    }
  }, [state]);

  useEffect(() => {
    // One-shot: pull the user's profile + refund data to prefill person +
    // auszahlung on wizard mount. Skip if either slice already has content
    // from a resumed session, or if we've already hydrated once this mount.
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const personEmpty =
      !state.person.vorname && !state.person.nachname && !state.person.email;
    const auszahlungEmpty = !state.auszahlung.iban && !state.auszahlung.bic;
    if (!personEmpty && !auszahlungEmpty) return;

    setHydrating(true);
    void (async () => {
      try {
        const rd = await api.getRefundData();
        setState((s) => ({
          ...s,
          person: personEmpty
            ? {
                vorname: rd.vorname,
                nachname: rd.nachname,
                email: rd.email,
                telefon: rd.telefon,
                kundennummer: s.person.kundennummer,
              }
            : s.person,
          auszahlung: auszahlungEmpty
            ? {
                kontoinhaber: `${rd.vorname} ${rd.nachname}`.trim(),
                iban: rd.iban ?? '',
                bic: rd.bic ?? '',
              }
            : s.auszahlung,
          hydrated: {
            person: {
              vorname: rd.vorname,
              nachname: rd.nachname,
              email: rd.email,
              telefon: rd.telefon,
            },
            auszahlung: {
              iban: rd.iban ?? '',
              bic: rd.bic ?? '',
            },
          },
        }));
      } catch {
        // Non-fatal — user can still type their details manually.
      } finally {
        setHydrating(false);
      }
    })();
    // Intentionally no deps — this must run exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    hydratedRef.current = false; // next mount can rehydrate
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const resetTicket = () =>
    setState((s) => ({
      ...INITIAL_STATE,
      // Preserve the pieces that are user-scoped, not ticket-scoped.
      person: s.person,
      auszahlung: s.auszahlung,
      hydrated: s.hydrated,
    }));

  return (
    <WizardContext.Provider
      value={{
        state,
        hydrating,
        update,
        updateFahrt,
        updatePerson,
        updateAuszahlung,
        reset,
        resetTicket,
      }}
    >
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
