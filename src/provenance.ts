/**
 * The supported provenance classifications for a sourced or scenario-provided property.
 */
export type ProvenanceKind =
  | "novel"
  | "supplementary-official"
  | "provisional"
  | "generated"
  | "override";

/**
 * The authority of a citation attached to a property claim.
 */
export type CitationAuthority = "novel" | "supplementary-official";

/**
 * Citation data accepted at the JSON-friendly provenance seam.
 */
export type CitationInput = {
  readonly source: string;
  readonly locator: string;
  readonly title?: string | undefined;
  readonly url?: string | undefined;
  readonly authority?: CitationAuthority | undefined;
};

/**
 * A normalized citation that lets a reader trace a Canonical Claim.
 */
export type Citation = {
  readonly source: string;
  readonly locator: string;
  readonly title: string | undefined;
  readonly url: string | undefined;
  readonly authority: CitationAuthority;
};

/**
 * Provenance data accepted from a decoded Scenario or catalog record.
 */
export type ProvenanceInput = {
  readonly kind: ProvenanceKind;
  readonly citation?: CitationInput | undefined;
  readonly citations?: readonly CitationInput[] | undefined;
  readonly authority?:
    | CitationAuthority
    | "assumption"
    | "generator"
    | "scenario-override"
    | undefined;
  readonly source?: string | undefined;
  readonly note?: string | undefined;
  readonly layerId?: string | undefined;
};

/**
 * Normalized property provenance with complete, immutable source metadata.
 */
export type Provenance = {
  readonly kind: ProvenanceKind;
  readonly authority: CitationAuthority | "assumption" | "generator" | "scenario-override";
  readonly citations: readonly Citation[];
  readonly citation: Citation | undefined;
  readonly source: string | undefined;
  readonly note: string | undefined;
  readonly layerId: string | undefined;
};

/**
 * Precision metadata used by presentation adapters instead of exposing raw floating-point digits.
 */
export type DisplayPrecision = {
  readonly significantDigits: number;
  readonly decimalPlaces: number | undefined;
  readonly uncertainty: number | undefined;
  readonly source: "input" | "uncertainty" | "default";
};

/**
 * Precision metadata accepted on a catalog property or Canonical Claim.
 */
export type DisplayPrecisionInput = {
  readonly significantDigits?: number | undefined;
  readonly decimalPlaces?: number | undefined;
  readonly uncertainty?: number | undefined;
};

/**
 * A value and conservative lower and upper bounds with its selected nominal value.
 *
 * The `lowerBound` and `upperBound` aliases make the contract explicit for callers that do not
 * want to infer whether `lower` and `upper` are inclusive.
 *
 * @typeParam Value - The value represented by the bounds.
 */
export type ConservativeBounds<Value> = {
  readonly nominal: Value;
  readonly lower: Value;
  readonly upper: Value;
  readonly lowerBound: Value;
  readonly upperBound: Value;
  readonly precision: DisplayPrecision;
};

/**
 * A numeric summary of the width of conservative bounds.
 */
export type ConservativeUncertaintyWidth = {
  readonly hasUncertainty: boolean;
  readonly relativeFactor: number;
  readonly absolute: number;
  readonly absoluteSeconds: number;
};

/**
 * The exact form of a Canonical Claim.
 *
 * @typeParam Value - The claimed value type.
 */
export type ExactCanonicalClaim<Value> = {
  readonly kind: "exact";
  readonly value: Value;
  readonly nominal: Value;
  readonly selectedNominal: Value;
  readonly provenance: Provenance;
  readonly precision: DisplayPrecision;
};

/**
 * The bounded range form of a Canonical Claim.
 *
 * @typeParam Value - The ranged value type.
 */
export type RangeCanonicalClaim<Value> = {
  readonly kind: "range";
  readonly lower: Value;
  readonly upper: Value;
  readonly nominal: Value;
  readonly selectedNominal: Value;
  readonly provenance: Provenance;
  readonly precision: DisplayPrecision;
};

/**
 * A qualitative Canonical Claim that intentionally has no numeric nominal value.
 */
export type QualitativeCanonicalClaim = {
  readonly kind: "qualitative";
  readonly statement: string;
  readonly value: undefined;
  readonly nominal: undefined;
  readonly selectedNominal: undefined;
  readonly provenance: Provenance;
  readonly precision: DisplayPrecision;
};

/**
 * The three source-claim forms supported by the Journey Model.
 *
 * @typeParam Value - The exact or ranged value type.
 */
export type CanonicalClaim<Value> =
  | ExactCanonicalClaim<Value>
  | RangeCanonicalClaim<Value>
  | QualitativeCanonicalClaim;

/**
 * A selected nominal value that retains the Canonical Claim it came from.
 *
 * @typeParam Value - The selected value type.
 */
export type SelectedNominal<Value> = {
  readonly kind: "selected-nominal";
  readonly value: Value;
  readonly nominal: Value;
  readonly claim: CanonicalClaim<Value>;
  readonly provenance: Provenance;
  readonly precision: DisplayPrecision;
};

/**
 * A property metadata record combining its selected value, source claim, provenance, and bounds.
 */
export type PropertyMetadata<Value = unknown> = {
  readonly property: string;
  readonly value: Value;
  readonly nominal: Value;
  readonly selectedNominal: Value;
  readonly claim: CanonicalClaim<Value> | undefined;
  readonly canonicalClaim: CanonicalClaim<Value> | undefined;
  readonly provenance: Provenance;
  readonly bounds: ConservativeBounds<Value> | undefined;
  readonly displayPrecision: DisplayPrecision;
};

/**
 * A property metadata record accepted on an entity input.
 */
export type PropertyMetadataInput<Value = unknown> = {
  readonly claim?: CanonicalClaim<Value> | Record<string, unknown> | undefined;
  readonly canonicalClaim?: CanonicalClaim<Value> | Record<string, unknown> | undefined;
  readonly provenance?: Provenance | ProvenanceInput | undefined;
  readonly value?: Value | undefined;
  readonly nominal?: Value | undefined;
  readonly precision?: DisplayPrecision | DisplayPrecisionInput | undefined;
  readonly bounds?: ConservativeBounds<Value> | undefined;
  readonly uncertainty?: ConservativeBounds<Value> | undefined;
};

/**
 * The canonical identity attached to an entity independently of property provenance.
 */
export type CanonicalIdentity = {
  readonly id: string;
  readonly designation: string | undefined;
  readonly name: string | undefined;
  readonly provenance: Provenance;
};

/**
 * Canonical identity data accepted on a Scenario entity input.
 */
export type CanonicalIdentityInput =
  | string
  | {
      readonly id?: string | undefined;
      readonly designation?: string | undefined;
      readonly name?: string | undefined;
      readonly provenance?: Provenance | ProvenanceInput | undefined;
    };

/**
 * One immutable property change in a Scenario override layer.
 */
export type ScenarioOverrideChange = {
  readonly entityType: string;
  readonly entityId: string;
  readonly property: string;
  readonly value: unknown;
  readonly claim: CanonicalClaim<unknown> | undefined;
  readonly provenance: Provenance;
  readonly reason: string | undefined;
};

/**
 * A property change accepted while constructing a Scenario override layer.
 */
export type ScenarioOverrideChangeInput = {
  readonly entityType: string;
  readonly entityId: string;
  readonly property: string;
  readonly value: unknown;
  readonly claim?: CanonicalClaim<unknown> | Record<string, unknown> | undefined;
  readonly provenance?: Provenance | ProvenanceInput | undefined;
  readonly reason?: string | undefined;
};

/**
 * An immutable, ordered layer of reversible Scenario property overrides.
 */
export type ScenarioOverrideLayer = {
  readonly id: string;
  readonly label: string;
  readonly changes: readonly ScenarioOverrideChange[];
  readonly parentLayerId: string | undefined;
  readonly provenance: Provenance;
};

/**
 * Override layer data accepted from a Scenario or a caller.
 */
export type ScenarioOverrideLayerInput = {
  readonly id: string;
  readonly label: string;
  readonly changes: readonly ScenarioOverrideChangeInput[];
  readonly parentLayerId?: string | undefined;
  readonly provenance?: Provenance | ProvenanceInput | undefined;
};

/**
 * A comparison between one property before and after applying Scenario overrides.
 */
export type OverrideChangeComparison = {
  readonly layerId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly property: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly changed: boolean;
  readonly provenance: Provenance;
};

/**
 * A calculated result that can be compared with a Canonical Claim.
 *
 * @typeParam Value - The derived nominal value type.
 */
export type DerivedResult<Value> = {
  readonly kind: "derived";
  readonly nominal: Value;
  readonly bounds: ConservativeBounds<Value>;
  readonly precision: DisplayPrecision;
};

/**
 * A visible disagreement between a Canonical Claim and a Derived Result.
 *
 * @typeParam Value - The compared value type.
 */
export type CanonDiscrepancy<Value> = {
  readonly kind: "canon-discrepancy";
  readonly property: string;
  readonly canonicalClaim: CanonicalClaim<Value>;
  readonly derivedResult: DerivedResult<Value>;
  readonly claim: CanonicalClaim<Value>;
  readonly result: DerivedResult<Value>;
  readonly message: string;
};

/**
 * Creates a normalized immutable citation.
 *
 * @param input - Citation source and locator data.
 * @returns A complete citation suitable for a Canonical Claim.
 * @throws RangeError when required citation fields are invalid.
 */
export function createCitation(input: CitationInput): Citation {
  if (!isRecord(input) || !isNonEmptyString(input.source) || !isNonEmptyString(input.locator)) {
    throw new RangeError("A citation requires non-empty source and locator strings.");
  }
  const authority = input.authority ?? inferCitationAuthority(input.source);
  if (authority !== "novel" && authority !== "supplementary-official") {
    throw new RangeError(`Unsupported citation authority ${String(authority)}.`);
  }
  return Object.freeze({
    source: input.source,
    locator: input.locator,
    title: input.title === undefined ? undefined : requireOptionalText(input.title, "title"),
    url: input.url === undefined ? undefined : requireOptionalText(input.url, "url"),
    authority,
  });
}

/**
 * Normalizes provenance and enforces citations for novel and supplementary official claims.
 *
 * @param input - Provenance to normalize.
 * @returns Complete immutable provenance metadata.
 * @throws RangeError when provenance or required citations are invalid.
 */
export function createProvenance(input: Provenance | ProvenanceInput): Provenance {
  if (!isRecord(input)) {
    throw new RangeError("Provenance must be an object.");
  }
  const kind = input.kind;
  if (
    kind !== "novel" &&
    kind !== "supplementary-official" &&
    kind !== "provisional" &&
    kind !== "generated" &&
    kind !== "override"
  ) {
    throw new RangeError(`Unsupported provenance kind ${String(kind)}.`);
  }
  const rawCitations: CitationInput[] = [];
  if (isCitationInput(input.citation)) {
    rawCitations.push(input.citation);
  }
  if (Array.isArray(input.citations)) {
    rawCitations.push(...input.citations.filter(isCitationInput));
  }
  const requiredCitationAuthority =
    kind === "novel"
      ? "novel"
      : kind === "supplementary-official"
        ? "supplementary-official"
        : undefined;
  const citations = deduplicateCitations(
    rawCitations.map((citation) =>
      createCitation({
        ...citation,
        authority: citation.authority ?? requiredCitationAuthority,
      }),
    ),
  );
  if ((kind === "novel" || kind === "supplementary-official") && citations.length === 0) {
    throw new RangeError(`${kind} provenance requires at least one citation.`);
  }
  if (
    requiredCitationAuthority !== undefined &&
    citations.some((citation) => citation.authority !== requiredCitationAuthority)
  ) {
    throw new RangeError(
      `${kind} provenance citations must use ${requiredCitationAuthority} authority.`,
    );
  }
  const authority =
    input.authority ??
    (kind === "novel"
      ? "novel"
      : kind === "supplementary-official"
        ? "supplementary-official"
        : kind === "provisional"
          ? "assumption"
          : kind === "generated"
            ? "generator"
            : "scenario-override");
  if (requiredCitationAuthority !== undefined && authority !== requiredCitationAuthority) {
    throw new RangeError(`${kind} provenance authority must be ${requiredCitationAuthority}.`);
  }
  if (
    authority !== "novel" &&
    authority !== "supplementary-official" &&
    authority !== "assumption" &&
    authority !== "generator" &&
    authority !== "scenario-override"
  ) {
    throw new RangeError(`Unsupported provenance authority ${String(authority)}.`);
  }
  const source = input.source ?? citations[0]?.source;
  return Object.freeze({
    kind,
    authority,
    citations: Object.freeze(citations),
    citation: citations[0],
    source: source === undefined ? undefined : requireOptionalText(source, "source"),
    note: input.note === undefined ? undefined : requireOptionalText(input.note, "note"),
    layerId:
      input.layerId === undefined ? undefined : requireOptionalText(input.layerId, "layerId"),
  });
}

/**
 * Creates novel-canon provenance from one or more citations.
 *
 * @param citations - Primary novel citations.
 * @returns Immutable novel provenance.
 */
export function novelProvenance(citations: CitationInput | readonly CitationInput[]): Provenance {
  return createProvenance({
    kind: "novel",
    citations: Array.isArray(citations) ? citations : [citations],
  });
}

/**
 * Creates supplementary official provenance from one or more citations.
 *
 * @param citations - Official supplementary citations.
 * @returns Immutable supplementary official provenance.
 */
export function supplementaryOfficialProvenance(
  citations: CitationInput | readonly CitationInput[],
): Provenance {
  return createProvenance({
    kind: "supplementary-official",
    citations: Array.isArray(citations) ? citations : [citations],
  });
}

/**
 * Creates provenance for an explicit provisional assumption.
 *
 * @param note - Explanation of the assumption, when available.
 * @returns Immutable provisional provenance.
 */
export function provisionalProvenance(note: string | undefined = undefined): Provenance {
  return createProvenance({ kind: "provisional", note });
}

/**
 * Creates provenance for a deterministic generated value.
 *
 * @param generator - Generator and version identifier.
 * @returns Immutable generated provenance.
 */
export function generatedProvenance(generator: string): Provenance {
  return createProvenance({ kind: "generated", source: generator });
}

/**
 * Creates provenance for a reversible Scenario override layer.
 *
 * @param layerId - Stable override layer identifier.
 * @param note - Optional reason for the override.
 * @returns Immutable override provenance.
 */
export function overrideProvenance(
  layerId: string,
  note: string | undefined = undefined,
): Provenance {
  return createProvenance({ kind: "override", layerId, note });
}

/**
 * Creates a complete display precision record.
 *
 * @param input - Precision values supplied by a source or inferred from uncertainty.
 * @param source - Why this precision was selected.
 * @returns Immutable display precision metadata.
 * @throws RangeError when precision values are not positive integers or finite uncertainties.
 */
export function createDisplayPrecision(
  input: DisplayPrecisionInput | DisplayPrecision,
  source: DisplayPrecision["source"] = "input",
): DisplayPrecision {
  if (!isRecord(input)) {
    throw new RangeError("Display precision must be an object.");
  }
  const uncertainty = input.uncertainty;
  let decimalPlaces = input.decimalPlaces;
  let significantDigits = input.significantDigits;
  if (
    significantDigits === undefined &&
    decimalPlaces === undefined &&
    uncertainty !== undefined &&
    uncertainty > 0
  ) {
    decimalPlaces = Math.max(0, Math.ceil(-Math.log10(uncertainty) - 1e-10));
    significantDigits = decimalPlaces + 1;
  }
  significantDigits ??= 6;
  if (!isPositiveInteger(significantDigits)) {
    throw new RangeError("Display precision significantDigits must be a positive integer.");
  }
  if (decimalPlaces !== undefined && !isNonNegativeInteger(decimalPlaces)) {
    throw new RangeError("Display precision decimalPlaces must be a non-negative integer.");
  }
  if (uncertainty !== undefined && (!Number.isFinite(uncertainty) || uncertainty < 0)) {
    throw new RangeError("Display precision uncertainty must be finite and non-negative.");
  }
  const inputSource = isRecord(input) ? (input as Partial<DisplayPrecision>).source : undefined;
  const normalizedSource =
    source === "input" &&
    (inputSource === "input" || inputSource === "uncertainty" || inputSource === "default")
      ? inputSource
      : source;
  return Object.freeze({
    significantDigits,
    decimalPlaces,
    uncertainty,
    source: normalizedSource,
  });
}

/**
 * Creates an exact Canonical Claim while preserving its source metadata.
 *
 * @param value - The exact claimed value.
 * @param provenance - The source provenance.
 * @param precision - Optional source display precision.
 * @returns An immutable exact Canonical Claim.
 */
export function exactClaim<Value>(
  value: Value,
  provenance: Provenance | ProvenanceInput,
  precision: DisplayPrecision | DisplayPrecisionInput | undefined = undefined,
): ExactCanonicalClaim<Value> {
  const normalizedValue = snapshotValue(value);
  const normalizedProvenance = createProvenance(provenance);
  const normalizedPrecision = precisionForValue(normalizedValue, precision);
  return Object.freeze({
    kind: "exact" as const,
    value: normalizedValue,
    nominal: normalizedValue,
    selectedNominal: normalizedValue,
    provenance: normalizedProvenance,
    precision: normalizedPrecision,
  });
}

export type RangeClaimOptions<Value> = {
  readonly lower: Value;
  readonly upper: Value;
  readonly nominal: Value;
  readonly provenance: Provenance | ProvenanceInput;
  readonly precision?: DisplayPrecision | DisplayPrecisionInput | undefined;
};

/**
 * Creates a bounded Canonical Claim from an explicit options record.
 *
 * @param options - Lower, upper, selected nominal, and source metadata.
 * @returns An immutable range Canonical Claim.
 */
export function rangeClaim<Value>(options: RangeClaimOptions<Value>): RangeCanonicalClaim<Value>;

/**
 * Creates a bounded Canonical Claim from lower, upper, nominal, and source arguments.
 *
 * @param lower - Inclusive lower bound.
 * @param upper - Inclusive upper bound.
 * @param nominal - Selected nominal value.
 * @param provenance - The source provenance.
 * @param precision - Optional source display precision.
 * @returns An immutable range Canonical Claim.
 */
export function rangeClaim<Value>(
  lower: Value,
  upper: Value,
  nominal: Value,
  provenance: Provenance | ProvenanceInput,
  precision?: DisplayPrecision | DisplayPrecisionInput | undefined,
): RangeCanonicalClaim<Value>;

/**
 * Creates a bounded Canonical Claim with the lower bound as a fallback nominal value.
 *
 * @param lower - Inclusive lower bound.
 * @param upper - Inclusive upper bound.
 * @param provenance - The source provenance.
 * @param precision - Optional source display precision.
 * @returns An immutable range Canonical Claim.
 */
export function rangeClaim<Value>(
  lower: Value,
  upper: Value,
  provenance: Provenance | ProvenanceInput,
  precision?: DisplayPrecision | DisplayPrecisionInput | undefined,
): RangeCanonicalClaim<Value>;

export function rangeClaim<Value>(
  first: RangeClaimOptions<Value> | Value,
  second?: Value,
  third?: Value | Provenance | ProvenanceInput,
  fourth?: Provenance | ProvenanceInput | DisplayPrecision | DisplayPrecisionInput,
  fifth?: DisplayPrecision | DisplayPrecisionInput,
): RangeCanonicalClaim<Value> {
  let lower: Value;
  let upper: Value;
  let nominal: Value;
  let provenance: Provenance | ProvenanceInput;
  let precision: DisplayPrecision | DisplayPrecisionInput | undefined;
  if (isRangeClaimOptions<Value>(first)) {
    ({ lower, upper, nominal, provenance, precision } = first);
  } else {
    lower = first;
    upper = second as Value;
    if (isProvenanceLike(third)) {
      nominal = lower;
      provenance = third;
      precision = fourth as DisplayPrecision | DisplayPrecisionInput | undefined;
    } else {
      nominal = third as Value;
      provenance = fourth as Provenance | ProvenanceInput;
      precision = fifth;
    }
  }
  const normalizedLower = snapshotValue(lower);
  const normalizedUpper = snapshotValue(upper);
  const normalizedNominal = snapshotValue(nominal);
  validateRangeOrder(normalizedLower, normalizedUpper);
  if (!valueIsWithinRange(normalizedNominal, normalizedLower, normalizedUpper)) {
    throw new RangeError("Canonical Claim nominal must lie inside its range.");
  }
  const normalizedProvenance = createProvenance(provenance);
  const normalizedPrecision = precisionForRange(
    normalizedLower,
    normalizedUpper,
    normalizedNominal,
    precision,
  );
  return Object.freeze({
    kind: "range" as const,
    lower: normalizedLower,
    upper: normalizedUpper,
    nominal: normalizedNominal,
    selectedNominal: normalizedNominal,
    provenance: normalizedProvenance,
    precision: normalizedPrecision,
  });
}

/**
 * Creates a qualitative Canonical Claim without inventing a numeric value.
 *
 * @param statement - The source's qualitative statement.
 * @param provenance - The source provenance.
 * @returns An immutable qualitative Canonical Claim.
 */
export function qualitativeClaim(
  statement: string,
  provenance: Provenance | ProvenanceInput,
): QualitativeCanonicalClaim {
  if (!isNonEmptyString(statement)) {
    throw new RangeError("A qualitative Canonical Claim requires a non-empty statement.");
  }
  return Object.freeze({
    kind: "qualitative" as const,
    statement,
    value: undefined,
    nominal: undefined,
    selectedNominal: undefined,
    provenance: createProvenance(provenance),
    precision: createDisplayPrecision({}, "default"),
  });
}

/**
 * Selects a calculation nominal from an exact or ranged Canonical Claim.
 *
 * @param claim - The source claim to retain.
 * @param value - Optional replacement nominal for a range.
 * @returns An immutable selected nominal wrapper.
 * @throws RangeError when a qualitative claim is selected or a value is outside its range.
 */
export function selectNominal<Value>(
  claim: ExactCanonicalClaim<Value> | RangeCanonicalClaim<Value>,
  value: Value | undefined = undefined,
): SelectedNominal<Value> {
  const normalizedClaim = normalizeClaim<Value>(claim);
  if (normalizedClaim.kind === "qualitative") {
    throw new RangeError("Qualitative Canonical Claims cannot select a nominal value.");
  }
  const selected = value === undefined ? normalizedClaim.nominal : snapshotValue(value);
  if (
    normalizedClaim.kind === "range" &&
    !valueIsWithinRange(selected, normalizedClaim.lower, normalizedClaim.upper)
  ) {
    throw new RangeError("Selected nominal must lie inside the Canonical Claim range.");
  }
  return Object.freeze({
    kind: "selected-nominal" as const,
    value: selected,
    nominal: selected,
    claim: normalizedClaim,
    provenance: normalizedClaim.provenance,
    precision: normalizedClaim.precision,
  });
}

/**
 * Creates conservative bounds for a nominal value.
 *
 * @param nominal - The selected nominal value.
 * @param lower - Inclusive lower bound.
 * @param upper - Inclusive upper bound.
 * @param precision - Optional display precision metadata.
 * @returns Immutable conservative bounds.
 */
export function conservativeBounds<Value>(
  nominal: Value,
  lower: Value,
  upper: Value,
  precision: DisplayPrecision | DisplayPrecisionInput | undefined = undefined,
): ConservativeBounds<Value> {
  const normalizedNominal = snapshotValue(nominal);
  const normalizedLower = snapshotValue(lower);
  const normalizedUpper = snapshotValue(upper);
  validateRangeOrder(normalizedLower, normalizedUpper);
  if (!valueIsWithinRange(normalizedNominal, normalizedLower, normalizedUpper)) {
    throw new RangeError("Conservative bounds must contain their nominal value.");
  }
  const rangePrecision = precisionForRange(
    normalizedLower,
    normalizedUpper,
    normalizedNominal,
    precision,
  );
  return Object.freeze({
    nominal: normalizedNominal,
    lower: normalizedLower,
    upper: normalizedUpper,
    lowerBound: normalizedLower,
    upperBound: normalizedUpper,
    precision: rangePrecision,
  });
}

/**
 * Creates exact conservative bounds for a value.
 *
 * @param value - The exact value.
 * @param precision - Optional display precision metadata.
 * @returns Immutable equal lower, nominal, and upper values.
 */
export function exactBounds<Value>(
  value: Value,
  precision: DisplayPrecision | DisplayPrecisionInput | undefined = undefined,
): ConservativeBounds<Value> {
  const normalizedValue = snapshotValue(value);
  const normalizedPrecision = precisionForValue(normalizedValue, precision);
  return Object.freeze({
    nominal: normalizedValue,
    lower: normalizedValue,
    upper: normalizedValue,
    lowerBound: normalizedValue,
    upperBound: normalizedValue,
    precision: normalizedPrecision,
  });
}

/**
 * Summarizes numeric uncertainty without converting units or changing the supplied bounds.
 *
 * Each numeric leaf is compared with the leaf at the same structural path. Relative half-widths
 * are dimensionless and added component-wise; unlike a Euclidean norm, this never combines meters,
 * seconds, radians, or dimensionless values into one magnitude. `absolute` is retained only for a
 * single numeric leaf because a structured value has no one meaningful absolute unit. The
 * `absoluteSeconds` field is populated only for a scalar tagged-seconds range so callers can safely
 * use it as temporal padding.
 *
 * Non-numeric unequal bounds still report `hasUncertainty`, but contribute no invented numeric
 * padding.
 *
 * @param bounds - Conservative bounds to summarize.
 * @returns An immutable uncertainty-width summary.
 */
export function conservativeUncertaintyWidth<Value>(
  bounds: ConservativeBounds<Value>,
): ConservativeUncertaintyWidth {
  const lowerValues = new Map(uncertaintyNumericComponents(bounds.lower));
  const upperValues = new Map(uncertaintyNumericComponents(bounds.upper));
  const nominalValues = new Map(uncertaintyNumericComponents(bounds.nominal));
  const componentWidths: number[] = [];
  let relativeFactor = 0;
  for (const path of [...nominalValues.keys()].sort()) {
    const lowerValue = lowerValues.get(path);
    const upperValue = upperValues.get(path);
    const nominalValue = nominalValues.get(path);
    if (lowerValue === undefined || upperValue === undefined || nominalValue === undefined) {
      continue;
    }
    const halfWidth = Math.abs(upperValue - lowerValue) / 2;
    if (!(halfWidth > 0) || !Number.isFinite(halfWidth)) {
      continue;
    }
    componentWidths.push(halfWidth);
    const componentScale =
      Math.abs(nominalValue) > 0
        ? Math.abs(nominalValue)
        : Math.max(Math.abs(lowerValue), Math.abs(upperValue));
    if (componentScale > 0 && Number.isFinite(componentScale)) {
      const componentRelativeWidth = halfWidth / componentScale;
      if (Number.isFinite(componentRelativeWidth)) {
        relativeFactor += componentRelativeWidth;
      }
    }
  }
  const secondsLower = uncertaintySecondsValue(bounds.lower);
  const secondsUpper = uncertaintySecondsValue(bounds.upper);
  const secondsNominal = uncertaintySecondsValue(bounds.nominal);
  const absoluteSeconds =
    secondsLower === undefined || secondsUpper === undefined || secondsNominal === undefined
      ? 0
      : Math.abs(secondsUpper - secondsLower) / 2;
  const absolute = componentWidths.length === 1 ? (componentWidths[0] ?? 0) : 0;
  return Object.freeze({
    hasUncertainty: !deepEqual(bounds.lower, bounds.upper),
    relativeFactor: Number.isFinite(relativeFactor) ? Math.max(0, relativeFactor) : 0,
    absolute: Number.isFinite(absolute) ? absolute : 0,
    absoluteSeconds: Number.isFinite(absoluteSeconds) ? absoluteSeconds : 0,
  });
}

/**
 * Converts a Canonical Claim into a selected property metadata record.
 *
 * @param property - The stable property name.
 * @param value - The selected property value.
 * @param input - Source claim and provenance metadata.
 * @returns Immutable property metadata.
 */
export function createPropertyMetadata<Value>(
  property: string,
  value: Value,
  input: PropertyMetadataInput<Value> | undefined = undefined,
): PropertyMetadata<Value> {
  if (!isNonEmptyString(property)) {
    throw new RangeError("Property metadata requires a non-empty property name.");
  }
  const metadata = input ?? {};
  const rawClaim = metadata.claim ?? metadata.canonicalClaim;
  const claim = rawClaim === undefined ? undefined : normalizeClaim<Value>(rawClaim);
  const nominal =
    claim === undefined
      ? snapshotValue((metadata.nominal ?? metadata.value ?? value) as Value)
      : (claim.nominal as Value);
  const provenance =
    metadata.provenance === undefined
      ? (claim?.provenance ?? provisionalProvenance(`No source supplied for ${property}.`))
      : createProvenance(metadata.provenance);
  const suppliedBounds = metadata.bounds ?? metadata.uncertainty;
  const bounds =
    suppliedBounds === undefined
      ? claim?.kind === "range"
        ? conservativeBounds(claim.nominal, claim.lower, claim.upper, claim.precision)
        : undefined
      : conservativeBounds(
          nominal,
          suppliedBounds.lower,
          suppliedBounds.upper,
          suppliedBounds.precision,
        );
  const displayPrecision =
    metadata.precision === undefined
      ? (claim?.precision ?? precisionForValue(nominal, undefined))
      : createDisplayPrecision(metadata.precision, "input");
  return Object.freeze({
    property,
    value: nominal,
    nominal,
    selectedNominal: nominal,
    claim,
    canonicalClaim: claim,
    provenance,
    bounds,
    displayPrecision,
  });
}

/**
 * Creates a derived result with nominal and conservative bounds.
 *
 * @param nominal - The calculated nominal value.
 * @param bounds - Optional bounds; omitted values are exact.
 * @param precision - Optional presentation precision.
 * @returns An immutable Derived Result.
 */
export function derivedResult<Value>(
  nominal: Value,
  bounds: ConservativeBounds<Value> | undefined = undefined,
  precision: DisplayPrecision | DisplayPrecisionInput | undefined = undefined,
): DerivedResult<Value> {
  const normalizedNominal = snapshotValue(nominal);
  const normalizedBounds =
    bounds === undefined
      ? exactBounds(normalizedNominal, precision)
      : conservativeBounds(normalizedNominal, bounds.lower, bounds.upper, bounds.precision);
  const normalizedPrecision =
    precision === undefined
      ? normalizedBounds.precision
      : createDisplayPrecision(precision, "input");
  return Object.freeze({
    kind: "derived" as const,
    nominal: normalizedNominal,
    bounds: normalizedBounds,
    precision: normalizedPrecision,
  });
}

/**
 * Constructs a Canon Discrepancy while retaining both unmodified sides of the comparison.
 *
 * @param property - Stable property or journey-result name.
 * @param claim - The Canonical Claim side.
 * @param result - The Derived Result side.
 * @param message - Optional reader-facing explanation.
 * @returns An immutable Canon Discrepancy.
 */
export function createCanonDiscrepancy<Value>(
  property: string,
  claim: CanonicalClaim<Value>,
  result: DerivedResult<Value>,
  message: string | undefined = undefined,
): CanonDiscrepancy<Value> {
  if (!isNonEmptyString(property)) {
    throw new RangeError("A Canon Discrepancy requires a property name.");
  }
  const normalizedClaim = normalizeClaim<Value>(claim);
  const normalizedResult = derivedResult(result.nominal, result.bounds, result.precision);
  return Object.freeze({
    kind: "canon-discrepancy" as const,
    property,
    canonicalClaim: normalizedClaim,
    derivedResult: normalizedResult,
    claim: normalizedClaim,
    result: normalizedResult,
    message:
      message ??
      `Canonical ${property} and the derived result disagree; both values remain available for inspection.`,
  });
}

/**
 * Compares a Canonical Claim with a Derived Result and returns a discrepancy only when they differ.
 *
 * @param property - Stable property or journey-result name.
 * @param claim - The Canonical Claim side.
 * @param result - The Derived Result side.
 * @returns A discrepancy, or undefined when the values agree or are not comparable.
 */
export function compareCanonicalClaim<Value>(
  property: string,
  claim: CanonicalClaim<Value>,
  result: DerivedResult<Value>,
): CanonDiscrepancy<Value> | undefined {
  const normalizedClaim = normalizeClaim<Value>(claim);
  if (normalizedClaim.kind === "qualitative") {
    return undefined;
  }
  const normalizedResult = derivedResult(result.nominal, result.bounds, result.precision);
  const derivedValue = normalizedResult.nominal;
  const agrees =
    normalizedClaim.kind === "exact"
      ? deepEqual(normalizedClaim.value, derivedValue)
      : valueIsWithinRange(derivedValue, normalizedClaim.lower, normalizedClaim.upper);
  return agrees ? undefined : createCanonDiscrepancy(property, normalizedClaim, normalizedResult);
}

/**
 * Creates an override layer and normalizes every change to override provenance.
 *
 * @param input - Layer identifier, label, and ordered property changes.
 * @returns An immutable Scenario override layer.
 */
export function createScenarioOverrideLayer(
  input: ScenarioOverrideLayerInput,
): ScenarioOverrideLayer {
  if (!isRecord(input) || !isNonEmptyString(input.id) || !isNonEmptyString(input.label)) {
    throw new RangeError("An override layer requires non-empty id and label strings.");
  }
  if (!Array.isArray(input.changes) || input.changes.length === 0) {
    throw new RangeError("An override layer requires at least one property change.");
  }
  const layerProvenance = overrideLayerProvenance(input);
  const changes = input.changes.map((change) => {
    if (
      !isRecord(change) ||
      !isNonEmptyString(change.entityType) ||
      !isNonEmptyString(change.entityId) ||
      !isNonEmptyString(change.property)
    ) {
      throw new RangeError("An override change requires entityType, entityId, and property.");
    }
    const claim = change.claim === undefined ? undefined : normalizeClaim<unknown>(change.claim);
    const value = claim === undefined ? snapshotValue(change.value) : claim.nominal;
    return Object.freeze({
      entityType: change.entityType,
      entityId: change.entityId,
      property: change.property,
      value,
      claim,
      provenance: layerProvenance,
      reason:
        change.reason === undefined ? undefined : requireOptionalText(change.reason, "reason"),
    });
  });
  return Object.freeze({
    id: input.id,
    label: input.label,
    changes: Object.freeze(changes),
    parentLayerId:
      input.parentLayerId === undefined
        ? undefined
        : requireOptionalText(input.parentLayerId, "parentLayerId"),
    provenance: layerProvenance,
  });
}

/**
 * Returns precision metadata suitable for a Canonical Claim.
 *
 * @param claim - The claim whose source precision or uncertainty should be used.
 * @returns Immutable display precision metadata.
 */
export function displayPrecisionForClaim<Value>(claim: CanonicalClaim<Value>): DisplayPrecision {
  return claim.precision;
}

/**
 * Formats a scalar or SI quantity according to explicit display precision metadata.
 *
 * @param value - A number or runtime-tagged SI quantity.
 * @param precision - Presentation precision.
 * @returns A deterministic human-readable value.
 */
export function formatDisplayValue(
  value: unknown,
  precision: DisplayPrecision | DisplayPrecisionInput,
): string {
  const normalized = createDisplayPrecision(precision, "input");
  if (isRecord(value) && typeof value.value === "number" && typeof value.unit === "string") {
    return `${formatNumber(value.value, normalized)} ${value.unit}`;
  }
  if (typeof value === "number") {
    return formatNumber(value, normalized);
  }
  return String(value);
}

/**
 * Alias for formatting a value with presentation precision metadata.
 */
export const formatWithPrecision = formatDisplayValue;

/**
 * Returns whether a value falls inside inclusive generic bounds.
 *
 * @param value - Candidate value.
 * @param lower - Inclusive lower bound.
 * @param upper - Inclusive upper bound.
 * @returns True when the candidate is inside the bounds.
 */
export function valueIsWithinRange<Value>(value: Value, lower: Value, upper: Value): boolean {
  if (!valuesAreCompatible(value, lower) || !valuesAreCompatible(value, upper)) {
    return false;
  }
  const valueNumber = comparableNumber(value);
  const lowerNumber = comparableNumber(lower);
  const upperNumber = comparableNumber(upper);
  if (valueNumber !== undefined && lowerNumber !== undefined && upperNumber !== undefined) {
    return valueNumber >= lowerNumber && valueNumber <= upperNumber;
  }
  return valueWithinBounds(value, lower, upper);
}

function normalizeClaim<Value>(input: unknown): CanonicalClaim<Value> {
  if (!isRecord(input)) {
    throw new RangeError("Canonical Claim must be an object.");
  }
  if (input.kind === "exact" && "value" in input) {
    return exactClaim(
      input.value as Value,
      normalizeProvenanceValue(input.provenance),
      normalizePrecisionValue(input.precision),
    );
  }
  if (input.kind === "range" && "lower" in input && "upper" in input) {
    return rangeClaim({
      lower: input.lower as Value,
      upper: input.upper as Value,
      nominal: (input.nominal ?? input.lower) as Value,
      provenance: normalizeProvenanceValue(input.provenance),
      precision: normalizePrecisionValue(input.precision),
    });
  }
  if (input.kind === "qualitative" && typeof input.statement === "string") {
    return qualitativeClaim(input.statement, normalizeProvenanceValue(input.provenance));
  }
  throw new RangeError("Canonical Claim must be exact, range, or qualitative.");
}

function normalizeProvenanceValue(value: unknown): Provenance {
  if (!isRecord(value)) {
    throw new RangeError("Canonical Claim provenance is required.");
  }
  return createProvenance(value as ProvenanceInput);
}

function normalizePrecisionValue(
  value: unknown,
): DisplayPrecision | DisplayPrecisionInput | undefined {
  return isRecord(value) && typeof value.significantDigits === "number"
    ? (value as unknown as DisplayPrecisionInput)
    : undefined;
}

function precisionForValue<Value>(
  value: Value,
  precision: DisplayPrecision | DisplayPrecisionInput | undefined,
): DisplayPrecision {
  if (precision !== undefined) {
    return createDisplayPrecision(precision, "input");
  }
  return createDisplayPrecision({}, "default");
}

function precisionForRange<Value>(
  lower: Value,
  upper: Value,
  nominal: Value,
  precision: DisplayPrecision | DisplayPrecisionInput | undefined,
): DisplayPrecision {
  if (precision !== undefined && isRecord(precision)) {
    const hasExplicitPrecision =
      precision.decimalPlaces !== undefined ||
      precision.significantDigits !== undefined ||
      precision.uncertainty !== undefined;
    if (hasExplicitPrecision) {
      return createDisplayPrecision(precision, "input");
    }
  }
  const lowerNumber = comparableNumber(lower);
  const upperNumber = comparableNumber(upper);
  const nominalNumber = comparableNumber(nominal);
  if (lowerNumber === undefined || upperNumber === undefined || nominalNumber === undefined) {
    return createDisplayPrecision({}, "default");
  }
  const uncertainty = Math.abs(upperNumber - lowerNumber) / 2;
  if (uncertainty === 0) {
    return createDisplayPrecision({}, "default");
  }
  const decimalPlaces = Math.max(0, Math.ceil(-Math.log10(uncertainty) - 1e-10));
  const integerDigits = Math.max(1, Math.floor(Math.log10(Math.abs(nominalNumber) || 1)) + 1);
  return createDisplayPrecision(
    {
      significantDigits: integerDigits + decimalPlaces,
      decimalPlaces,
      uncertainty,
    },
    "uncertainty",
  );
}

function valueWithinBounds(value: unknown, lower: unknown, upper: unknown): boolean {
  if (!valuesAreCompatible(value, lower) || !valuesAreCompatible(value, upper)) {
    return false;
  }
  const valueNumber = comparableNumber(value);
  const lowerNumber = comparableNumber(lower);
  const upperNumber = comparableNumber(upper);
  if (valueNumber !== undefined && lowerNumber !== undefined && upperNumber !== undefined) {
    return valueNumber >= lowerNumber && valueNumber <= upperNumber;
  }
  if (Array.isArray(value) && Array.isArray(lower) && Array.isArray(upper)) {
    return (
      value.length === lower.length &&
      value.length === upper.length &&
      value.every((child, index) => valueWithinBounds(child, lower[index], upper[index]))
    );
  }
  if (isRecord(value) && isRecord(lower) && isRecord(upper)) {
    const keys = Object.keys(value);
    return (
      keys.length === Object.keys(lower).length &&
      keys.length === Object.keys(upper).length &&
      keys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(lower, key) &&
          Object.prototype.hasOwnProperty.call(upper, key) &&
          valueWithinBounds(value[key], lower[key], upper[key]),
      )
    );
  }
  return deepEqual(value, lower) || deepEqual(value, upper);
}

function valuesAreCompatible(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null || typeof left !== typeof right) {
    return false;
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => valuesAreCompatible(value, right[index]));
  }
  const leftQuantity = taggedQuantityUnit(left);
  const rightQuantity = taggedQuantityUnit(right);
  if (leftQuantity !== undefined || rightQuantity !== undefined) {
    return leftQuantity !== undefined && leftQuantity === rightQuantity;
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        valuesAreCompatible(left[key], right[key]),
    )
  );
}

function taggedQuantityUnit(value: unknown): string | undefined {
  return isRecord(value) && typeof value.value === "number" && typeof value.unit === "string"
    ? value.unit
    : undefined;
}

function comparableNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (isRecord(value) && typeof value.value === "number" && Number.isFinite(value.value)) {
    return value.value;
  }
  return undefined;
}

function validateRangeOrder<Value>(lower: Value, upper: Value): void {
  if (!valuesAreCompatible(lower, upper)) {
    throw new RangeError("Canonical Claim bounds must use compatible structures and units.");
  }
  const lowerNumber = comparableNumber(lower);
  const upperNumber = comparableNumber(upper);
  if (lowerNumber !== undefined && upperNumber !== undefined && lowerNumber > upperNumber) {
    throw new RangeError("Canonical Claim lower bound must not exceed its upper bound.");
  }
}

function formatNumber(value: number, precision: DisplayPrecision): string {
  if (precision.decimalPlaces !== undefined) {
    return value.toFixed(precision.decimalPlaces);
  }
  return value.toPrecision(precision.significantDigits).replace(/(?:\.0+|(?<=[0-9])0+)e/, "e");
}

function inferCitationAuthority(source: string): CitationAuthority {
  return /official|supplementary/i.test(source) ? "supplementary-official" : "novel";
}

function deduplicateCitations(citations: readonly Citation[]): Citation[] {
  const seen = new Set<string>();
  const result: Citation[] = [];
  for (const citation of citations) {
    const key = `${citation.authority}\u0000${citation.source}\u0000${citation.locator}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(citation);
    }
  }
  return result;
}

function snapshotValue<Value>(
  value: Value,
  seen: WeakMap<object, unknown> = new WeakMap<object, unknown>(),
): Value {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return seen.get(objectValue) as Value;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(objectValue, copy);
    for (const child of value as readonly unknown[]) {
      copy.push(snapshotValue(child, seen));
    }
    return Object.freeze(copy) as Value;
  }
  const copy = Object.create(Object.getPrototypeOf(objectValue)) as Record<string, unknown>;
  seen.set(objectValue, copy);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    copy[key] = snapshotValue((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(copy) as Value;
}

type NumericUncertaintyComponent = readonly [path: string, value: number];

function uncertaintyNumericComponents(
  value: unknown,
  path = "$",
): readonly NumericUncertaintyComponent[] {
  if (typeof value === "number" && Number.isFinite(value)) {
    return [[path, value]];
  }
  if (isRecord(value)) {
    if (typeof value.value === "number" && Number.isFinite(value.value)) {
      return [[path, value.value]];
    }
    return Object.keys(value)
      .sort()
      .flatMap((key) => uncertaintyNumericComponents(value[key], `${path}.${key}`));
  }
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      uncertaintyNumericComponents(child, `${path}[${index}]`),
    );
  }
  return [];
}

function uncertaintySecondsValue(value: unknown): number | undefined {
  if (!isRecord(value) || value.unit !== "s" || typeof value.value !== "number") {
    return undefined;
  }
  return Number.isFinite(value.value) ? value.value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requireOptionalText(value: unknown, field: string): string {
  if (!isNonEmptyString(value)) {
    throw new RangeError(`${field} must be a non-empty string when supplied.`);
  }
  return value;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isCitationInput(value: unknown): value is CitationInput {
  return isRecord(value) && isNonEmptyString(value.source) && isNonEmptyString(value.locator);
}

function isRangeClaimOptions<Value>(value: unknown): value is RangeClaimOptions<Value> {
  return (
    isRecord(value) &&
    "lower" in value &&
    "upper" in value &&
    "nominal" in value &&
    "provenance" in value
  );
}

function isProvenanceLike(value: unknown): value is Provenance | ProvenanceInput {
  return isRecord(value) && typeof value.kind === "string";
}

function overrideLayerProvenance(input: ScenarioOverrideLayerInput): Provenance {
  if (input.provenance !== undefined) {
    const provided = createProvenance(input.provenance);
    if (provided.kind === "override") {
      return createProvenance({
        ...provided,
        kind: "override",
        authority: "scenario-override",
        layerId: input.id,
      });
    }
  }
  return overrideProvenance(input.id);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]),
      )
    );
  }
  return false;
}

/**
 * Alias using the shorter domain name for Canon Discrepancy comparisons.
 */
export const compareCanonClaim = compareCanonicalClaim;

/**
 * Alias for the canonical provenance factory used by catalog adapters.
 */
export const provenance = createProvenance;
