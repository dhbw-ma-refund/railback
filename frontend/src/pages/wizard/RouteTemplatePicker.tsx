import type { RouteTemplateView } from '../../lib/api';
import { useRouteTemplates } from '../../lib/useRouteTemplates';
import { useLanguage } from '../../lib/LanguageContext';
import './RouteTemplatePicker.css';

interface Props {
  /**
   * Called when the user taps a template chip. The parent (FahrtStep /
   * LookupStep) applies the template's from/to (+ optional preferred
   * category) to its local state.
   */
  onPick: (tpl: RouteTemplateView) => void;
  /** templateId currently marked as picked, so we can highlight it. */
  activeTemplateId: string | null;
}

/**
 * Horizontal chip picker for saved routes. Reads from the shared
 * template cache (useRouteTemplates), so ticking "Als Strecke speichern"
 * elsewhere in the wizard causes a new chip to appear here instantly
 * — no refetch required.
 *
 * Empty list → renders nothing (no empty-state copy). Load failures are
 * silent: templates are a convenience, and gating the FahrtStep on a
 * template list fetch would penalize a user who doesn't use them at all.
 */
export const RouteTemplatePicker = ({ onPick, activeTemplateId }: Props) => {
  const { t } = useLanguage();
  const { templates } = useRouteTemplates();

  // Loading (templates === null) and empty-state both collapse to null so
  // we don't reserve vertical space above the form when there's nothing
  // useful to show yet.
  if (!templates || templates.length === 0) return null;

  return (
    <section className="route-templates" aria-labelledby="route-templates-title">
      <h2 id="route-templates-title" className="route-templates__title">
        {t.wizard.reise.savedRoutesTitle}
      </h2>
      <div className="route-templates__row" role="list">
        {templates.map((tpl) => {
          const isActive = tpl.templateId === activeTemplateId;
          return (
            <button
              key={tpl.templateId}
              type="button"
              role="listitem"
              className={
                'route-templates__chip' +
                (isActive ? ' route-templates__chip--active' : '')
              }
              onClick={() => onPick(tpl)}
              aria-pressed={isActive}
            >
              <span className="route-templates__chip-label">{tpl.label}</span>
              <span className="route-templates__chip-route">
                {tpl.fromStation} → {tpl.toStation}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
