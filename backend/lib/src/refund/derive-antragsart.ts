// Derive the antragsart from the fahrt-state, or honour an explicit override.
// Override path is the user's escape hatch when our auto-derivation disagrees
// with what they want to claim — we still validate it's a member of ANTRAGSARTEN.

import { AppError } from "../errors/index.js";
import { ANTRAGSARTEN, type Antragsart, type Antragsgrund } from "../types/enums.js";

export interface DeriveAntragsartInput {
  delayMinutes: number;
  anyCancelled: boolean;
  antragsgrund: Antragsgrund[];
  hasBelege: boolean;
  isZeitkarte: boolean;
  override?: Antragsart;
}

export function deriveAntragsart(input: DeriveAntragsartInput): Antragsart {
  if (input.override !== undefined) {
    if (!(ANTRAGSARTEN as readonly string[]).includes(input.override)) {
      throw new AppError(
        "ERR_VALIDATION",
        `Ungültige Antragsart: ${input.override}`,
        undefined,
        { field: "antragsart", value: input.override }
      );
    }
    return input.override;
  }

  const grund = input.antragsgrund;

  if (input.anyCancelled || grund.includes("AUSFALL")) {
    return "ERSTATTUNG_FAHRKARTE";
  }

  if (input.isZeitkarte) {
    return "ENTSCHAEDIGUNG_ZEITKARTE";
  }

  const hasDelayGrund =
    grund.includes("VERSPAETUNG") || grund.includes("VERPASSTER_ANSCHLUSS");

  if (input.hasBelege && hasDelayGrund) {
    return "KOSTEN_ALTERNATIVTRANSPORT";
  }

  if (input.delayMinutes >= 120) {
    return "ENTSCHAEDIGUNG_120_PLUS";
  }

  if (input.delayMinutes >= 60) {
    return "ENTSCHAEDIGUNG_60_119";
  }

  throw new AppError("ERR_NO_CLAIM", "keine Anspruchsgrundlage");
}
