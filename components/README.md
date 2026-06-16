# components/ — RailBack Form Primitives

Standalone-React-Komponentenbibliothek für die Admin-Front-Forms, gebaut
direkt aus `Railback_Brand_Design.md`. Bewusst außerhalb von `frontend/`
abgelegt, damit sie weder mit der bestehenden `frontend/shared/components/`
noch mit dem Solid-Code in `frontend/admin-panel/` kollidiert.

## Verhältnis zu `frontend/shared/components/`

`frontend/shared/components/` enthält bereits `Button`, `Input`, `Card`,
`StatusBadge` mit globalen `rb-*`-Klassen und der Repo-üblichen
`Figtree`-Schrift via `@shared/design-system/base.css`.

Diese Library hier ist davon **getrennt**:

- CSS Modules statt globaler `rb-*`-Klassen.
- System-Font-Stack via `--rb-font-family-base` in `tokens.css`
  (Figtree austauschbar an einer Stelle).
- Schwerpunkt auf vollständigem Form-Primitives-Set
  (Textarea, Select, Checkbox, Radio/RadioGroup, FormField, FieldSet),
  das in der bestehenden Library noch nicht existiert.

Eine spätere Konsolidierung — entweder Übernahme einzelner Komponenten in
`frontend/shared/components/` oder Migration der bestehenden vier hierher —
ist offen und nicht Teil dieses PRs.

## Stack

- React 18+, TypeScript.
- CSS Modules (`*.module.css` mit `composes`).
- Bundler-Anforderung: jeder Bundler mit CSS-Modules-Support
  (Vite, Next.js, Parcel).

## Setup im konsumierenden Projekt

```ts
// Einmalig im App-Entry, bevor Komponenten gerendert werden:
import "components/tokens.css";
```

`tokens.css` setzt sämtliche `--rb-*`-Custom-Properties auf `:root`.
Komponenten-Module referenzieren ausschließlich diese Variablen.

## Komponenten

| Komponente   | Zweck                                                 |
| ------------ | ----------------------------------------------------- |
| `Button`     | Pillenförmig, Primary / Secondary, drei Größen        |
| `Input`      | Single-line, alle nativen `type`-Werte                |
| `Textarea`   | Mehrzeilig, vertikal resizable                        |
| `Select`     | Native `<select>`, gestylt                            |
| `Checkbox`   | Mit eingebautem Label                                 |
| `Radio`      | Einzel-Radio, in `RadioGroup` zu kapseln              |
| `RadioGroup` | Container mit `role="radiogroup"`, propagiert `name`  |
| `FormField`  | Wrapper: Label + Hint + Error + ARIA-Verknüpfung      |
| `FieldSet`   | `<fieldset>` + `<legend>` für Gruppen-Controls        |

## Beispiel

```tsx
import {
  Button,
  Checkbox,
  FieldSet,
  FormField,
  Input,
  Radio,
  RadioGroup,
  Select,
  Textarea,
} from "components";

export function ExampleForm() {
  return (
    <form>
      <FormField label="E-Mail" required hint="Wir nutzen sie nur für Status-Updates.">
        <Input type="email" name="email" autoComplete="email" />
      </FormField>

      <FormField label="Notiz" optional>
        <Textarea name="note" placeholder="Optional" />
      </FormField>

      <FormField label="Status" error="Bitte einen Status wählen.">
        <Select name="status" defaultValue="">
          <option value="" disabled>
            Bitte wählen
          </option>
          <option value="pending">In Prüfung</option>
          <option value="approved">Bewilligt</option>
          <option value="rejected">Abgelehnt</option>
        </Select>
      </FormField>

      <FieldSet legend="Erstattungsart" required>
        <RadioGroup name="refund-type">
          <Radio value="full" label="Vollständig" />
          <Radio value="partial" label="Teilweise" />
        </RadioGroup>
      </FieldSet>

      <Checkbox name="confirm" label="Yes, I'm sure" />

      <Button type="submit">Speichern</Button>
      <Button variant="secondary">Abbrechen</Button>
    </form>
  );
}
```

## Live-Vorschau ohne Build

`demo.html` ist eine Standalone-Vorschauseite. Sie lädt React per ESM-CDN
und rendert jede Komponente in allen relevanten Zuständen. Wegen
`file://`-Restriktionen einiger Browser am besten via Mini-Server starten:

```sh
cd components
python3 -m http.server 8000
# dann http://localhost:8000/demo.html
```

Die Demo bildet die Komponenten-Logik inline nach, weil Browser ohne
Bundler die `*.module.css`-Imports und `composes`-Direktiven nicht
auflösen können. Sie ist eine visuelle Vorschau, kein Funktionstest der
echten Imports — das passiert erst im Vite-Build des konsumierenden
Projekts.

## Designentscheidungen

- **Native Controls.** `Checkbox`, `Radio` und `Select` rendern weiterhin
  natives HTML; nur die Darstellung ist gestylt. Tastatur-Navigation,
  Form-Reset, Mobile-Picker und Screenreader-Status bleiben ohne
  Zusatzcode korrekt (§10.3 Styleguide).
- **Touch-Target ≥ 44 px** (§10.2).
- **Fehler nicht nur über Farbe** (§10.4): `FormField` rendert
  Error-Icon + Text und setzt `aria-invalid` automatisch, sobald
  `error` gesetzt ist.
- **`:focus-visible`** statt `:focus` für den Fokus-Ring.

## Was hier nicht enthalten ist

Kein Modal/ConfirmModal, keine Card, keine Badge/StatusPill, keine
Icons-Library, keine Form-State-Hooks (Formik / RHF / eigen). Liegt
außerhalb des Form-Primitives-Scopes dieses Pakets. Card und StatusBadge
gibt es bereits in `frontend/shared/components/`.
