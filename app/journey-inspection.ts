import type {
  CanonDiscrepancy,
  CanonicalClaim,
  DerivedResult,
  DisplayPrecision,
  JourneySample,
  MultiLegJourneyTimeline,
  Provenance,
  Seconds,
} from "../src/index";
import { formatDuration } from "./format";

const PERCENT_EPSILON = 1e-9;
const MAX_FORMAT_DEPTH = 5;

type CanonicalClaimView = {
  readonly kind: CanonicalClaim<Seconds>["kind"];
  readonly value: string | undefined;
  readonly nominal: string | undefined;
  readonly lower: string | undefined;
  readonly upper: string | undefined;
  readonly statement: string | undefined;
  readonly provenance: ProvenanceView;
  readonly precision: PrecisionView;
};

type DerivedResultView = {
  readonly nominal: string;
  readonly lower: string;
  readonly upper: string;
  readonly precision: PrecisionView;
};

export type PrecisionView = {
  readonly significantDigits: number;
  readonly decimalPlaces: number | undefined;
  readonly uncertainty: number | undefined;
  readonly source: DisplayPrecision["source"];
};

export type ProvenanceView = {
  readonly kind: Provenance["kind"];
  readonly authority: Provenance["authority"];
  readonly source: string | undefined;
  readonly note: string | undefined;
  readonly citations: readonly string[];
};

export type JourneyDiscrepancyInspection = {
  readonly property: string;
  readonly message: string;
  readonly canonicalClaim: CanonicalClaimView;
  readonly derivedResult: DerivedResultView;
};

export type JourneyArrivalWindowProjection = {
  readonly nominalPercent: number;
  readonly lowerPercent: number;
  readonly upperPercent: number;
  readonly leftPercent: number;
  readonly widthPercent: number;
  readonly hasUncertainty: boolean;
  readonly ariaLabel: string;
};

export type JourneyPlaybackAnnouncementInput = {
  readonly sample: JourneySample | undefined;
  readonly timeline: MultiLegJourneyTimeline;
  readonly isPlaying: boolean;
  readonly error: string | undefined;
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function percentLabel(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Projects the model-owned bounded arrival window onto the nominal Journey scrubber. */
export function projectJourneyArrivalWindow(
  sample: Pick<JourneySample, "uncertainty">,
  timeline: MultiLegJourneyTimeline,
): JourneyArrivalWindowProjection {
  const departure = timeline.departureCoordinateTime.value;
  const duration = timeline.arrivalCoordinateTime.value - departure;
  const nominalPercent = 100;
  const lowerValue = sample.uncertainty.arrivalWindow.lower.value;
  const upperValue = sample.uncertainty.arrivalWindow.upper.value;
  const lowerPercent =
    duration > PERCENT_EPSILON ? clampPercent(((lowerValue - departure) / duration) * 100) : 100;
  const upperPercent =
    duration > PERCENT_EPSILON ? clampPercent(((upperValue - departure) / duration) * 100) : 100;
  const leftPercent = Math.min(lowerPercent, upperPercent);
  const rightPercent = Math.max(lowerPercent, upperPercent);
  const widthPercent = Math.max(0, rightPercent - leftPercent);
  const uncertaintyLabel = sample.uncertainty.hasUncertainty
    ? `bounded arrival window ${percentLabel(leftPercent)} to ${percentLabel(rightPercent)}`
    : "nominal-only arrival window";
  return Object.freeze({
    nominalPercent,
    lowerPercent,
    upperPercent,
    leftPercent,
    widthPercent,
    hasUncertainty: sample.uncertainty.hasUncertainty,
    ariaLabel: `Nominal Journey arrival at ${percentLabel(nominalPercent)}; ${uncertaintyLabel}.`,
  });
}

function safeNumber(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(6) : "non-finite";
}

function safePropertyValue(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : "[accessor]";
  } catch {
    return "[unreadable]";
  }
}

/** Formats model values deterministically without unsafe JSON/stringification of object graphs. */
export function formatInspectableValue(
  value: unknown,
  seen: Set<object> = new Set<object>(),
  depth = 0,
): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  }
  if (typeof value === "number") {
    return safeNumber(value);
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value !== "object") {
    return `[${typeof value}]`;
  }
  if (seen.has(value)) {
    return "[cyclic]";
  }
  if (depth >= MAX_FORMAT_DEPTH) {
    return "[…]";
  }
  seen.add(value);
  try {
    const objectValue = value as object;
    const valueDescriptor = Object.getOwnPropertyDescriptor(objectValue, "value");
    const unitDescriptor = Object.getOwnPropertyDescriptor(objectValue, "unit");
    if (
      valueDescriptor !== undefined &&
      "value" in valueDescriptor &&
      typeof valueDescriptor.value === "number" &&
      unitDescriptor !== undefined &&
      "value" in unitDescriptor &&
      typeof unitDescriptor.value === "string"
    ) {
      if (unitDescriptor.value === "s") {
        return formatDuration(valueDescriptor.value);
      }
      return `${safeNumber(valueDescriptor.value)} ${unitDescriptor.value}`;
    }
    if (Array.isArray(value)) {
      return `[${value.map((entry) => formatInspectableValue(entry, seen, depth + 1)).join(", ")}]`;
    }
    const keys = Object.keys(objectValue).sort();
    return `{${keys
      .map(
        (key) =>
          `${key}: ${formatInspectableValue(safePropertyValue(objectValue, key), seen, depth + 1)}`,
      )
      .join(", ")}}`;
  } catch {
    return "[unreadable]";
  } finally {
    seen.delete(value);
  }
}

function precisionView(precision: DisplayPrecision): PrecisionView {
  return Object.freeze({
    significantDigits: precision.significantDigits,
    decimalPlaces: precision.decimalPlaces,
    uncertainty: precision.uncertainty,
    source: precision.source,
  });
}

function provenanceView(provenance: Provenance): ProvenanceView {
  return Object.freeze({
    kind: provenance.kind,
    authority: provenance.authority,
    source: provenance.source,
    note: provenance.note,
    citations: Object.freeze(
      provenance.citations.map((citation) => {
        const title = citation.title === undefined ? "" : ` — ${citation.title}`;
        const url = citation.url === undefined ? "" : ` (${citation.url})`;
        return `${citation.source} @ ${citation.locator}${title}${url}`;
      }),
    ),
  });
}

function canonicalClaimView(claim: CanonicalClaim<Seconds>): CanonicalClaimView {
  const common = {
    kind: claim.kind,
    provenance: provenanceView(claim.provenance),
    precision: precisionView(claim.precision),
  } as const;
  if (claim.kind === "qualitative") {
    return Object.freeze({
      ...common,
      value: undefined,
      nominal: undefined,
      lower: undefined,
      upper: undefined,
      statement: claim.statement,
    });
  }
  if (claim.kind === "range") {
    return Object.freeze({
      ...common,
      value: undefined,
      nominal: formatInspectableValue(claim.nominal),
      lower: formatInspectableValue(claim.lower),
      upper: formatInspectableValue(claim.upper),
      statement: undefined,
    });
  }
  return Object.freeze({
    ...common,
    value: formatInspectableValue(claim.value),
    nominal: formatInspectableValue(claim.nominal),
    lower: undefined,
    upper: undefined,
    statement: undefined,
  });
}

function derivedResultView(result: DerivedResult<Seconds>): DerivedResultView {
  return Object.freeze({
    nominal: formatInspectableValue(result.nominal),
    lower: formatInspectableValue(result.bounds.lower),
    upper: formatInspectableValue(result.bounds.upper),
    precision: precisionView(result.precision),
  });
}

type AssociatedPhase =
  | NonNullable<JourneySample["phase"]>
  | NonNullable<JourneySample["phaseDetails"]>;

function phaseAssociationTokens(
  phase: AssociatedPhase | undefined,
  timeline: MultiLegJourneyTimeline,
): readonly string[] {
  if (phase === undefined) {
    return Object.freeze([]);
  }
  const connection = `${phase.departureGateId}->${phase.destinationGateId}`;
  return Object.freeze(
    [
      phase.departureGateId,
      phase.destinationGateId,
      timeline.shipProfileId,
      connection,
      `journey:${connection}`,
      `step:${phase.stepIndex}`,
      `phase:${phase.stepIndex}`,
      `leg:${phase.stepIndex}`,
      phase.kind,
    ].map((token) => token.toLowerCase()),
  );
}

function discrepancyMatchesPhase(
  discrepancy: CanonDiscrepancy<Seconds>,
  tokens: readonly string[],
): boolean {
  const property = discrepancy.property.toLowerCase();
  return tokens.some((token) => token.length > 2 && property.includes(token));
}

function correspondingDiscrepancies(
  sample: JourneySample,
  timeline: MultiLegJourneyTimeline,
): readonly CanonDiscrepancy<Seconds>[] {
  const discrepancies = sample.phaseDetails?.discrepancies ?? sample.discrepancies;
  const activeTokens = phaseAssociationTokens(sample.phaseDetails ?? sample.phase, timeline);
  if (activeTokens.length === 0 || discrepancies.length === 0) {
    return discrepancies;
  }
  const associated = discrepancies.filter((discrepancy) =>
    discrepancyMatchesPhase(discrepancy, activeTokens),
  );
  const anyAssociationMetadata = discrepancies.some((discrepancy) =>
    timeline.phases.some((phase) =>
      discrepancyMatchesPhase(discrepancy, phaseAssociationTokens(phase, timeline)),
    ),
  );
  // Generic journey properties have no phase association metadata, so retaining all of them is
  // the conservative fallback. Once any discrepancy carries entity/phase path metadata, only the
  // corresponding active-phase subset is shown.
  return anyAssociationMetadata ? Object.freeze(associated) : discrepancies;
}

/** Builds an inspectable, phase-corresponding discrepancy view model. */
export function inspectJourneyDiscrepancies(
  sample: JourneySample,
  timeline: MultiLegJourneyTimeline,
): readonly JourneyDiscrepancyInspection[] {
  return Object.freeze(
    correspondingDiscrepancies(sample, timeline).map((discrepancy) =>
      Object.freeze({
        property: discrepancy.property,
        message: discrepancy.message,
        canonicalClaim: canonicalClaimView(discrepancy.canonicalClaim),
        derivedResult: derivedResultView(discrepancy.derivedResult),
      }),
    ),
  );
}

/** Produces a stable announcement that changes only on discrete playback transitions. */
export function deriveJourneyPlaybackAnnouncement(input: JourneyPlaybackAnnouncementInput): string {
  if (input.error !== undefined) {
    return `Journey playback error: ${input.error}`;
  }
  if (input.sample === undefined) {
    return "Journey playback unavailable.";
  }
  const end = input.timeline.arrivalCoordinateTime.value;
  const status =
    input.sample.coordinateTime.value >= end - PERCENT_EPSILON
      ? "Journey ended at arrival."
      : input.isPlaying
        ? "Journey playing."
        : "Journey paused.";
  const phase =
    input.sample.phase === undefined
      ? "No active phase."
      : `Phase ${input.sample.phaseIndex === undefined ? "" : `${input.sample.phaseIndex + 1} `}${input.sample.phase.kind}.`;
  const event =
    input.sample.event === undefined
      ? "Continuous sample."
      : `Exact event ${input.sample.eventIndex === undefined ? "" : `${input.sample.eventIndex + 1} `}${input.sample.event.kind}.`;
  return `${status} ${phase} ${event}`;
}
