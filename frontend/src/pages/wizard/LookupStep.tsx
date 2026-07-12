import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button } from '@shared/components';
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

      {/* Search — plain guide-conformant Inputs. Order mirrors how users think
          about a past trip: where from/to first, then when. */}
      <div className="rl-search">
        <div className="rl-where">
          <Input
            label={t.wizard.lookup.from}
            placeholder="z.B. Mannheim Hbf"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          {/* Swap sits inline with the "Zielbahnhof" label row, right-aligned.
              This avoids the centering problem that comes from putting a circle
              button between two label+input units. */}
          <div className="rl-to">
            <div className="rl-to__labelrow">
              <span className="rl-to__label">{t.wizard.lookup.to}</span>
              <button
                type="button"
                className="rl-swap"
                onClick={swap}
                aria-label={t.wizard.lookup.swap}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                <span>{t.wizard.lookup.swap}</span>
              </button>
            </div>
            <Input
              placeholder="z.B. Karlsruhe Hbf"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label={t.wizard.lookup.to}
            />
          </div>
        </div>

        <div className="rl-when">
          <Input
            label={t.wizard.lookup.date}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input
            label={t.wizard.lookup.aroundTime}
            type="time"
            value={aroundTime}
            onChange={(e) => setAroundTime(e.target.value)}
          />
        </div>

        <Button
          variant="primary"
          size="large"
          onClick={runSearch}
          disabled={!from || !to || !date}
          className="rl-search-btn"
        >
          {t.wizard.lookup.search}
        </Button>
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
                            <span className="rl-status__icon" aria-hidden="true">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="6" y1="6" x2="18" y2="18" />
                                <line x1="18" y1="6" x2="6" y2="18" />
                              </svg>
                            </span>
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
                            <span className="rl-status__ok" aria-hidden="true">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
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

                    <span className="rl-card__chev" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 6 15 12 9 18" />
                      </svg>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
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
