import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../lib/LanguageContext';
import { WizardLayout } from './WizardLayout';
import { WizardStepButtons } from './WizardStepButtons';
import { useWizard } from './WizardContext';
import './LookupStep.css';

/**
 * Route-lookup for past trips. This is NOT a bahn.de-style timetable search —
 * that's for buying tickets. Here the user already took the trip and needs to
 * find *the specific train that was delayed or cancelled* so its delay data
 * seeds the claim form.
 *
 * The hierarchy is optimised for that job:
 *   1. Delay minutes (red, huge) — the qualifying information.
 *   2. Cancellation status (red banner) — a hard-yes for compensation.
 *   3. Train number + times — for identifying "yes, that was my train".
 *
 * Deliberately absent: seat class, occupancy, price, "Karte anzeigen",
 * anything future-trip-shopping-related. Those would just add noise.
 *
 * Backend contract: mirrors POST /route-lookup — from/to/date/timeWindow →
 * list of candidates. Selecting one seeds fahrt.* state and jumps to the
 * Reisedaten step (where the user can still edit).
 */

interface Candidate {
  trainNr: string;              // display label — "ICE 109"
  category: 'S' | 'RE' | 'IC' | 'ICE';
  abfahrt_plan: string;         // "HH:MM"
  ankunft_plan: string;         // "HH:MM"
  abfahrt_actual: string;
  ankunft_actual: string;
  delayMinutes: number;         // 0 = on time
  cancelled: boolean;
}

const STATIC_CANDIDATES: Candidate[] = [
  { trainNr: 'IC 2345',  category: 'IC',  abfahrt_plan: '08:14', ankunft_plan: '08:45', abfahrt_actual: '08:47', ankunft_actual: '09:52', delayMinutes: 67, cancelled: false },
  { trainNr: 'ICE 279',  category: 'ICE', abfahrt_plan: '09:02', ankunft_plan: '09:31', abfahrt_actual: '09:02', ankunft_actual: '09:31', delayMinutes: 0,  cancelled: false },
  { trainNr: 'RE 4',     category: 'RE',  abfahrt_plan: '09:24', ankunft_plan: '10:11', abfahrt_actual: '—',     ankunft_actual: '—',     delayMinutes: 0,  cancelled: true  },
  { trainNr: 'ICE 511',  category: 'ICE', abfahrt_plan: '10:38', ankunft_plan: '11:07', abfahrt_actual: '10:52', ankunft_actual: '11:31', delayMinutes: 24, cancelled: false },
];

const delayTone = (mins: number, cancelled: boolean) => {
  if (cancelled) return 'cancelled';
  if (mins >= 60) return 'severe';
  if (mins >= 15) return 'moderate';
  if (mins > 0) return 'minor';
  return 'ontime';
};

export const LookupStep = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { updateFahrt } = useWizard();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');
  const [aroundTime, setAroundTime] = useState('');
  const [searched, setSearched] = useState(false);

  const runSearch = () => setSearched(Boolean(from && to && date));
  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const pick = (c: Candidate) => {
    updateFahrt({
      abreisebahnhof: from,
      zielbahnhof: to,
      abreisedatum: date,
      zugnummer_plan: c.trainNr,
      abfahrtszeit_plan: c.abfahrt_plan,
      ankunftszeit_plan: c.ankunft_plan,
    });
    navigate('/antrag/neu/reise');
  };

  return (
    <WizardLayout title={t.wizard.lookup.title}>
      <p className="wizard-helper">{t.wizard.lookup.hint}</p>

      {/* Search — date-led, since that's the point of a past-trip lookup. */}
      <div className="rl-search">
        {/* Row 1: Date + time window take the top slot. */}
        <div className="rl-when">
          <label className="rl-pill rl-pill--priority">
            <span className="rl-pill__glyph" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            <span className="rl-pill__label">{t.wizard.lookup.date}</span>
            <input
              className="rl-pill__input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <label className="rl-pill rl-pill--narrow">
            <span className="rl-pill__glyph" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
            </span>
            <span className="rl-pill__label">{t.wizard.lookup.aroundTime}</span>
            <input
              className="rl-pill__input"
              type="time"
              value={aroundTime}
              onChange={(e) => setAroundTime(e.target.value)}
            />
          </label>
        </div>

        {/* Row 2: Origin / destination, with a swap button between them. */}
        <div className="rl-where">
          <label className="rl-pill">
            <span className="rl-pill__dot" aria-hidden="true" />
            <span className="rl-pill__label">{t.wizard.lookup.from}</span>
            <input
              className="rl-pill__input"
              placeholder="z.B. Mannheim Hbf"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            {from && (
              <button
                type="button"
                className="rl-pill__clear"
                onClick={() => setFrom('')}
                aria-label="Löschen"
              >
                ×
              </button>
            )}
          </label>

          <button type="button" className="rl-swap" onClick={swap} aria-label="Start und Ziel tauschen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>

          <label className="rl-pill">
            <span className="rl-pill__glyph" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s-7-7-7-13a7 7 0 1 1 14 0c0 6-7 13-7 13z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </span>
            <span className="rl-pill__label">{t.wizard.lookup.to}</span>
            <input
              className="rl-pill__input"
              placeholder="z.B. Karlsruhe Hbf"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            {to && (
              <button
                type="button"
                className="rl-pill__clear"
                onClick={() => setTo('')}
                aria-label="Löschen"
              >
                ×
              </button>
            )}
          </label>
        </div>

        <button
          type="button"
          className="rl-search-btn"
          onClick={runSearch}
          disabled={!from || !to || !date}
        >
          {t.wizard.lookup.search}
        </button>
      </div>

      {searched && (
        <div className="rl-results">
          <h2 className="rl-results__title">{t.wizard.lookup.resultsTitle}</h2>
          <p className="wizard-helper rl-results__hint">{t.wizard.lookup.pickHint}</p>

          <ul className="rl-list">
            {STATIC_CANDIDATES.map((c) => {
              const tone = delayTone(c.delayMinutes, c.cancelled);
              return (
                <li key={c.trainNr} className={`rl-card rl-card--${tone}`}>
                  <button type="button" className="rl-card__hit" onClick={() => pick(c)}>
                    {/* Left rail — a colored strip that visually mirrors the delay tone.
                        Combined with the big minutes value it makes the row scannable. */}
                    <span className="rl-card__rail" aria-hidden="true" />

                    <div className="rl-card__body">
                      {/* Row 1 — train identity + planned times. This is how the user
                          confirms "yes, that's my train". */}
                      <div className="rl-card__idrow">
                        <span className={`rl-badge rl-badge--${c.category.toLowerCase()}`}>
                          {c.trainNr}
                        </span>
                        <span className="rl-card__times">
                          {c.abfahrt_plan} → {c.ankunft_plan}
                        </span>
                      </div>

                      {/* Row 2 — status: this is the LOUD row. Delay in minutes,
                          or a cancellation banner. */}
                      <div className={`rl-status rl-status--${tone}`}>
                        {c.cancelled ? (
                          <>
                            <span className="rl-status__icon" aria-hidden="true">×</span>
                            <span className="rl-status__main">{t.wizard.lookup.cancelled}</span>
                          </>
                        ) : c.delayMinutes > 0 ? (
                          <>
                            <span className="rl-status__delta">+{c.delayMinutes}</span>
                            <div className="rl-status__stack">
                              <span className="rl-status__main">{t.wizard.lookup.minutesLate}</span>
                              <span className="rl-status__sub">
                                {t.wizard.lookup.actual}: {c.abfahrt_actual} → {c.ankunft_actual}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="rl-status__ok" aria-hidden="true">✓</span>
                            <span className="rl-status__main">{t.wizard.lookup.onTime}</span>
                          </>
                        )}
                      </div>

                      {/* Row 3 — station names anchoring the trip, small. */}
                      <div className="rl-card__stations">
                        <span>{from || '—'}</span>
                        <span aria-hidden="true">→</span>
                        <span>{to || '—'}</span>
                      </div>
                    </div>

                    <span className="rl-card__chev" aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="wizard-helper">
            {t.wizard.lookup.noMatchHint}{' '}
            <button
              type="button"
              className="rl-manual-link"
              onClick={() => navigate('/antrag/neu/reise')}
            >
              {t.wizard.lookup.manualLink}
            </button>
          </p>
        </div>
      )}

      <WizardStepButtons
        onBack={() => navigate('/antrag/neu')}
        onNext={() => navigate('/antrag/neu/reise')}
        nextLabel={t.wizard.lookup.skipToManual}
      />
    </WizardLayout>
  );
};
