/**
 * Pure translation from the wizard's local state shape to the exact
 * RefundRequest body the backend expects at POST /users/me/tickets/{id}/refund.
 *
 * Kept as a standalone function so it can be unit-tested (no React, no
 * side-effects) and so ReviewStep stays focused on flow control. Any change
 * to backend/lib/src/schemas/ticket.ts:refundRequestSchema happens here.
 *
 * Wizard antragsgrund values are the same enum the backend expects
 * (VERSPAETUNG | AUSFALL | VERPASSTER_ANSCHLUSS), so there's no mapping —
 * we just deduplicate.
 */
import type { WizardState, AntragsgrundTag } from './WizardContext';
import type { Antragsgrund, RefundRequest } from '../../lib/api';

/** Deduplicate the tags. Type-level identity since AntragsgrundTag === Antragsgrund. */
export function mapAntragsgrundTags(tags: AntragsgrundTag[]): Antragsgrund[] {
  return Array.from(new Set(tags));
}

/**
 * Build the RefundRequest body. Throws with a message-shaped Error if a
 * required field is missing — the caller (ReviewStep) should have kept the
 * submit button disabled in that state, so this is a defensive assert.
 */
export function buildRefundBody(state: WizardState): RefundRequest {
  if (!state.antragsart) {
    throw new Error('missing antragsart');
  }
  if (state.problem.antragsgrund.length === 0) {
    throw new Error('missing antragsgrund');
  }
  const f = state.fahrt;
  const required: Array<keyof typeof f> = [
    'abreisedatum',
    'abreisebahnhof',
    'zielbahnhof',
    'abfahrtszeit_plan',
    'ankunftszeit_plan',
    'zugnummer_plan',
    'fahrkartennummer',
    'fahrkartenpreis',
  ];
  for (const key of required) {
    if (!f[key]) throw new Error(`missing fahrt.${key}`);
  }

  const antragsgrund = mapAntragsgrundTags(state.problem.antragsgrund);

  // Backend requires verpasster_anschluss_bahnhof non-null when
  // antragsgrund includes VERPASSTER_ANSCHLUSS.
  const includesMissedConnection = antragsgrund.includes('VERPASSTER_ANSCHLUSS');
  const missedBahnhof = state.problem.verpasster_anschluss_bahnhof?.trim() || null;
  if (includesMissedConnection && !missedBahnhof) {
    throw new Error('missing verpasster_anschluss_bahnhof');
  }

  const body: RefundRequest = {
    antragsgrund,
    antragsart: state.antragsart,
    is_zeitkarte: state.is_zeitkarte || undefined,
    fahrt: {
      abreisedatum: f.abreisedatum!,
      abreisebahnhof: f.abreisebahnhof!,
      zielbahnhof: f.zielbahnhof!,
      abfahrtszeit_plan: f.abfahrtszeit_plan!,
      ankunftszeit_plan: f.ankunftszeit_plan!,
      zugnummer_plan: f.zugnummer_plan!,
      zugkategorie_plan: f.zugkategorie_plan || undefined,
      fahrkartennummer: f.fahrkartennummer!,
      fahrkartenpreis: f.fahrkartenpreis!,
    },
    fahrt_tatsaechlich: {
      // The contract accepts `null` for "not applicable"; the wizard doesn't
      // capture the tatsaechlich_* travel times in this pass — backend will
      // derive delay data from ticket + delays lookup at submit.
      ankunftsdatum_tatsaechlich: null,
      abfahrtszeit_tatsaechlich: null,
      ankunftszeit_tatsaechlich: null,
      zugnummer_tatsaechlich: null,
      verpasster_anschluss_bahnhof: missedBahnhof,
    },
    antragstellung_ort: state.antragstellung_ort,
    zusaetzliche_angaben: state.zusaetzliche_angaben || undefined,
    datenschutz_einwilligung: true,
    wahrheitserklaerung: true,
  };
  return body;
}
