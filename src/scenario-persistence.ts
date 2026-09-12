import {
  compileScenario,
  createScenarioReference,
  createScenarioSeed,
  getTrustedCompiledScenarioIndexOwner,
  isTrustedCompiledScenario,
  isTrustedCompiledScenarioIndex,
  type CompiledGate,
  type CompiledGateConnection,
  type CompiledOrbitalAnchor,
  type CompiledScenario,
  type CompiledShipProfile,
  type CompiledSystem,
  type ScenarioCanonicalClaim,
  type ScenarioEpoch,
  type ScenarioGenerationMetadataInput,
  type ScenarioInput,
  type ScenarioReference,
  type ScenarioReferenceInput,
  type ScenarioSeed,
  type ScenarioSeedInput,
  type SavedJourneyInput,
  type StableId,
  type ValidationIssue,
} from "./model";
import { isTrustedGeneratedClusterRegion, type GeneratedClusterRegion } from "./cluster-generation";
import type { ScenarioPersistenceAdapter } from "./scenario-persistence-adapter";
import {
  DEFAULT_SCENARIO_GENERATOR_VERSION,
  isSupportedScenarioGeneratorVersion,
  SUPPORTED_SCENARIO_GENERATOR_VERSIONS,
} from "./generator-versions";
import type {
  CanonicalIdentity,
  PropertyMetadata,
  Provenance,
  ScenarioOverrideLayer,
} from "./provenance";

/**
 * The first persisted Scenario schema, retained as a deterministic migration source.
 */
export const LEGACY_SCENARIO_SCHEMA_VERSION = 1;

/**
 * The current canonical Scenario export schema.
 */
export const CURRENT_SCENARIO_SCHEMA_VERSION = 2;

/**
 * Alias for the current Scenario schema version.
 */
export const SCENARIO_SCHEMA_VERSION = CURRENT_SCENARIO_SCHEMA_VERSION;

/**
 * A version string used for manually authored Scenarios that have no procedural generator.
 */
export { DEFAULT_SCENARIO_GENERATOR_VERSION } from "./generator-versions";

/**
 * Generator metadata versions accepted by Scenario persistence.
 */
export { SUPPORTED_SCENARIO_GENERATOR_VERSIONS } from "./generator-versions";

/**
 * A deterministic fallback seed used when importing a legacy hand-authored Scenario without seed
 * metadata.
 */
export const DEFAULT_SCENARIO_SEED = "manual";

/**
 * Every schema version understood by this module, including the current version.
 */
export const SUPPORTED_SCENARIO_SCHEMA_VERSIONS = Object.freeze([
  LEGACY_SCENARIO_SCHEMA_VERSION,
  CURRENT_SCENARIO_SCHEMA_VERSION,
] as const);

/**
 * A serialized System record in a canonical Scenario document.
 */
export type ScenarioExportSystem = CompiledSystem;

/**
 * A serialized Orbital Anchor record. JSON uses `null` for an absent parent reference.
 */
export type ScenarioExportOrbitalAnchor = Omit<CompiledOrbitalAnchor, "parentId"> & {
  readonly parentId: StableId | null;
};

/**
 * A serialized Gate record in a canonical Scenario document.
 */
export type ScenarioExportGate = CompiledGate;

/**
 * A serialized Gate Connection record in a canonical Scenario document.
 */
export type ScenarioExportGateConnection = CompiledGateConnection;

/**
 * A serialized Ship Profile record in a canonical Scenario document.
 */
export type ScenarioExportShipProfile = CompiledShipProfile;

/**
 * The immutable, versioned document produced before canonical JSON serialization.
 *
 * Entity arrays are identifier-sorted. Override changes and saved Journey inputs retain their
 * authored order because those arrays are ordered input. Undefined object properties are omitted
 * by canonical serialization; `null` is used only for an absent Orbital Anchor parent.
 */
export type ScenarioExportDocument = {
  readonly kind: "centauri-scenario";
  readonly schemaVersion: typeof CURRENT_SCENARIO_SCHEMA_VERSION;
  readonly generatorVersion: string;
  readonly seed: ScenarioSeed;
  readonly seedIdentity: string;
  readonly seedText: string;
  readonly logicalPopulation: number;
  readonly id: StableId;
  readonly designation: string;
  readonly name: string;
  readonly epoch: ScenarioEpoch;
  readonly systems: readonly ScenarioExportSystem[];
  readonly orbitalAnchors: readonly ScenarioExportOrbitalAnchor[];
  readonly gates: readonly ScenarioExportGate[];
  readonly gateConnections: readonly ScenarioExportGateConnection[];
  readonly shipProfiles: readonly ScenarioExportShipProfile[];
  readonly references: readonly ScenarioReference[];
  readonly canonicalClaims: readonly ScenarioCanonicalClaim[];
  readonly overrides: readonly ScenarioOverrideLayer[];
  readonly journeyInputs: readonly SavedJourneyInput[];
  readonly canonicalIdentity: CanonicalIdentity;
  readonly provenance: Provenance;
  readonly properties: Readonly<Record<string, PropertyMetadata<unknown>>>;
  readonly propertyProvenance: Readonly<Record<string, PropertyMetadata<unknown>>>;
};

/**
 * Optional persistence metadata and saved inputs supplied while exporting a Scenario.
 */
export type ScenarioExportOptions = {
  readonly generatorVersion?: string | undefined;
  readonly seed?: ScenarioSeedInput | undefined;
  readonly logicalPopulation?: number | undefined;
  readonly generation?: ScenarioGenerationMetadataInput | undefined;
  readonly journeyInputs?: readonly SavedJourneyInput[] | undefined;
  readonly savedJourneyInputs?: readonly SavedJourneyInput[] | undefined;
};

/**
 * Structured failure categories returned by Scenario export, import, and migration validation.
 */
export type ScenarioPersistenceIssueCode =
  | "invalid-json"
  | "invalid-document"
  | "invalid-schema-version"
  | "unsupported-schema-version"
  | "invalid-generation-metadata"
  | "unsupported-generator-version"
  | "invalid-seed"
  | "invalid-reference"
  | "invalid-journey-input"
  | "prototype-pollution"
  | "non-finite-number"
  | "invalid-scenario"
  | "migration-failed";

/**
 * An actionable explanation of one rejected or migrated Scenario document field.
 */
export type ScenarioPersistenceIssue = {
  readonly code: ScenarioPersistenceIssueCode;
  readonly path: string;
  readonly message: string;
  readonly expected: string | undefined;
  readonly received: string | undefined;
};

/**
 * A successful immutable Scenario migration result.
 */
export type ScenarioMigrationSuccess = {
  readonly ok: true;
  readonly migrated: boolean;
  readonly fromSchemaVersion: number;
  readonly toSchemaVersion: typeof CURRENT_SCENARIO_SCHEMA_VERSION;
  readonly document: ScenarioExportDocument;
  readonly data: ScenarioExportDocument;
  readonly serialized: string;
  readonly scenario: CompiledScenario;
  readonly issues: readonly [];
};

/**
 * An unsuccessful Scenario migration result with no replacement document.
 */
export type ScenarioMigrationFailure = {
  readonly ok: false;
  readonly migrated: false;
  readonly fromSchemaVersion: number | undefined;
  readonly toSchemaVersion: typeof CURRENT_SCENARIO_SCHEMA_VERSION;
  readonly document: undefined;
  readonly data: undefined;
  readonly serialized: undefined;
  readonly scenario: undefined;
  readonly issues: readonly ScenarioPersistenceIssue[];
};

/**
 * The discriminated result returned by Scenario migration.
 */
export type ScenarioMigrationResult = ScenarioMigrationSuccess | ScenarioMigrationFailure;

/**
 * A successful transactional Scenario import result.
 */
export type ScenarioImportSuccess = {
  readonly ok: true;
  readonly scenario: CompiledScenario;
  readonly document: ScenarioExportDocument;
  readonly data: ScenarioExportDocument;
  readonly serialized: string;
  readonly migrated: boolean;
  readonly migratedFrom: number | undefined;
  readonly issues: readonly [];
};

/**
 * An unsuccessful transactional Scenario import result. The caller's current Scenario is never
 * replaced by this result.
 */
export type ScenarioImportFailure = {
  readonly ok: false;
  readonly scenario: undefined;
  readonly document: undefined;
  readonly data: undefined;
  readonly serialized: undefined;
  readonly migrated: false;
  readonly migratedFrom: number | undefined;
  readonly issues: readonly ScenarioPersistenceIssue[];
};

/**
 * The discriminated result returned by Scenario import.
 */
export type ScenarioImportResult = ScenarioImportSuccess | ScenarioImportFailure;

type RecordValue = Record<string, unknown>;
type JsonSnapshot = RecordValue | readonly unknown[] | string | number | boolean | null;
type SnapshotOptions = {
  readonly allowUndefinedObjectProperties: boolean;
  readonly allowUndefinedObjectProperty?: (path: string, key: string, parent: object) => boolean;
  readonly omitObjectProperty?: (
    path: string,
    key: string,
    value: unknown,
    parent: object,
  ) => boolean;
};

const STRICT_SNAPSHOT_OPTIONS: SnapshotOptions = Object.freeze({
  allowUndefinedObjectProperties: false,
});
const OMIT_UNDEFINED_SNAPSHOT_OPTIONS: SnapshotOptions = Object.freeze({
  allowUndefinedObjectProperties: true,
});

/**
 * A supported source for Scenario export, including a generated region wrapper.
 */
export type ScenarioExportSource = CompiledScenario | ScenarioInput | GeneratedClusterRegion;

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SCENARIO_KIND = "centauri-scenario";
const EMPTY_ISSUES = Object.freeze([]) as readonly [];
const RAW_SCENARIO_INPUT_SNAPSHOT_OPTIONS: SnapshotOptions = Object.freeze({
  allowUndefinedObjectProperties: false,
  allowUndefinedObjectProperty: allowRawScenarioUndefinedProperty,
  omitObjectProperty: omitRawScenarioDerivedProperty,
});

/**
 * Creates an immutable canonical Scenario document from a compiled or raw Scenario.
 *
 * @param source - A compiled Scenario, complete Scenario input, or generated region wrapper.
 * @param options - Optional generator metadata or replacement saved Journey inputs.
 * @returns A deeply immutable canonical Scenario document.
 * @throws RangeError when the source or supplied persistence metadata cannot be compiled.
 */
export function createScenarioExport(
  source: ScenarioExportSource,
  options: ScenarioExportOptions = {},
): ScenarioExportDocument {
  const scenario = toCompiledScenario(source);
  const base = scenario.overrideBase ?? scenario;
  const generation = resolveGenerationMetadata(base, options);
  validatePropertyMetadataValues(base.properties, "properties");
  validatePropertyMetadataValues(base.propertyProvenance, "propertyProvenance");
  validateEntityPropertyMetadata(base.systems, "systems");
  validateEntityPropertyMetadata(base.orbitalAnchors, "orbitalAnchors");
  validateEntityPropertyMetadata(base.gates, "gates");
  validateEntityPropertyMetadata(base.gateConnections, "gateConnections");
  validateEntityPropertyMetadata(base.shipProfiles, "shipProfiles");
  const journeyInputs = normalizeExportJourneyInputs(scenario, options);
  const epoch = snapshotScenarioValue(base.epoch, new WeakSet<object>(), "epoch");
  if (!isValidEpoch(epoch)) {
    throw new RangeError("Scenario export epoch must contain a finite seconds quantity.");
  }
  validateOverrideValues(scenario.overrideLayers);
  const overrides = snapshotRecordArray(scenario.overrideLayers, "overrides");
  const document = {
    kind: SCENARIO_KIND,
    schemaVersion: CURRENT_SCENARIO_SCHEMA_VERSION,
    generatorVersion: generation.generatorVersion,
    seed: generation.seed,
    seedIdentity: generation.seed.identity,
    seedText: generation.seed.text,
    logicalPopulation: generation.logicalPopulation,
    id: requiredExportText(base.id, "id"),
    designation: requiredExportText(base.designation, "designation"),
    name: requiredExportText(base.name, "name"),
    epoch: epoch as ScenarioEpoch,
    systems: snapshotRecordsById(base.systems, "systems") as readonly ScenarioExportSystem[],
    orbitalAnchors: snapshotRecordsById(base.orbitalAnchors, "orbitalAnchors").map((entity) => ({
      ...entity,
      parentId: entity.parentId ?? null,
    })) as readonly ScenarioExportOrbitalAnchor[],
    gates: snapshotRecordsById(base.gates, "gates") as readonly ScenarioExportGate[],
    gateConnections: snapshotRecordsById(
      base.gateConnections,
      "gateConnections",
    ) as readonly ScenarioExportGateConnection[],
    shipProfiles: snapshotRecordsById(
      base.shipProfiles,
      "shipProfiles",
    ) as readonly ScenarioExportShipProfile[],
    references: snapshotScenarioReferences(base.references),
    canonicalClaims: snapshotCanonicalClaims(base.canonicalClaims),
    overrides: overrides as readonly ScenarioOverrideLayer[],
    journeyInputs,
    canonicalIdentity: snapshotRequiredRecord(
      base.canonicalIdentity,
      "canonicalIdentity",
    ) as CanonicalIdentity,
    provenance: snapshotRequiredRecord(base.provenance, "provenance") as Provenance,
    properties: snapshotRequiredRecord(base.properties, "properties") as Readonly<
      Record<string, PropertyMetadata<unknown>>
    >,
    propertyProvenance: snapshotRequiredRecord(
      base.propertyProvenance,
      "propertyProvenance",
    ) as Readonly<Record<string, PropertyMetadata<unknown>>>,
  };
  const safeDocument = snapshotScenarioValue(
    document,
    new WeakSet<object>(),
    "$",
    STRICT_SNAPSHOT_OPTIONS,
  );
  return deepFreeze(safeDocument) as ScenarioExportDocument;
}

/**
 * Serializes a Scenario into a deterministic compact JSON representation.
 *
 * Object keys are lexicographically sorted, entity/reference/claim arrays are sorted by stable
 * identifier, and authored override/Journey order is retained. No whitespace is emitted.
 *
 * @param source - A compiled Scenario, complete Scenario input, or generated region wrapper.
 * @param options - Optional generator metadata or replacement saved Journey inputs.
 * @returns Canonical JSON bytes suitable for storage, comparison, and import.
 * @throws RangeError when the source contains unsupported or non-finite values.
 */
export function serializeScenario(
  source: ScenarioExportSource,
  options: ScenarioExportOptions = {},
): string {
  return canonicalJson(createScenarioExport(source, options));
}

/**
 * Exports a Scenario as canonical JSON.
 *
 * @param source - A compiled Scenario, complete Scenario input, or generated region wrapper.
 * @param options - Optional generator metadata or replacement saved Journey inputs.
 * @returns Canonical JSON bytes suitable for storage, backup, or transfer.
 */
export const exportScenario = serializeScenario;

/**
 * Migrates a JSON Scenario document to the current canonical schema and compiles it before
 * returning. The v1 nested `generator`, `scenario`, `connections`, `overrideLayers`, and `journeys`
 * aliases are supported explicitly; no future schema is guessed or coerced.
 *
 * @param input - A JSON string or an unknown decoded document.
 * @returns A transactional migration result with a compiled Scenario only on success.
 */
export function migrateScenario(input: unknown): ScenarioMigrationResult {
  const parsed = parseDocument(input);
  if (!parsed.ok) {
    return migrationFailure(undefined, parsed.issues);
  }

  const versionResult = readSchemaVersion(parsed.value);
  if (!versionResult.ok) {
    return migrationFailure(versionResult.version, versionResult.issues);
  }
  const fromSchemaVersion = versionResult.version;
  if (
    !SUPPORTED_SCENARIO_SCHEMA_VERSIONS.includes(
      fromSchemaVersion as (typeof SUPPORTED_SCENARIO_SCHEMA_VERSIONS)[number],
    )
  ) {
    return migrationFailure(fromSchemaVersion, [
      persistenceIssue(
        "unsupported-schema-version",
        "schemaVersion",
        `Scenario schema version ${fromSchemaVersion} is not supported; supported versions are ${SUPPORTED_SCENARIO_SCHEMA_VERSIONS.join(", ")}.`,
        "one of the supported schema versions",
        String(fromSchemaVersion),
      ),
    ]);
  }

  const migratedInput =
    fromSchemaVersion === LEGACY_SCENARIO_SCHEMA_VERSION
      ? migrateV1Document(parsed.value)
      : { ok: true as const, value: parsed.value };
  if (migratedInput.ok !== true) {
    return migrationFailure(fromSchemaVersion, migratedInput.issues);
  }

  const normalized = normalizeCurrentDocument(
    migratedInput.value,
    fromSchemaVersion === CURRENT_SCENARIO_SCHEMA_VERSION,
  );
  if (!normalized.ok) {
    return migrationFailure(fromSchemaVersion, normalized.issues);
  }
  const scenarioInput = documentToScenarioInput(normalized.value);
  const compiled = compileScenario(scenarioInput);
  if (!compiled.ok) {
    return migrationFailure(fromSchemaVersion, scenarioIssues(compiled.issues));
  }

  let document: ScenarioExportDocument;
  let serialized: string;
  try {
    document = createScenarioExport(compiled.scenario);
    serialized = canonicalJson(document);
  } catch (error) {
    return migrationFailure(fromSchemaVersion, [
      persistenceIssue(
        "migration-failed",
        "$",
        error instanceof Error ? error.message : "Scenario migration could not be serialized.",
        "a JSON-compatible Scenario",
        undefined,
      ),
    ]);
  }

  return Object.freeze({
    ok: true as const,
    migrated: fromSchemaVersion !== CURRENT_SCENARIO_SCHEMA_VERSION,
    fromSchemaVersion,
    toSchemaVersion: CURRENT_SCENARIO_SCHEMA_VERSION,
    document,
    data: document,
    serialized,
    scenario: compiled.scenario,
    issues: EMPTY_ISSUES,
  });
}

/**
 * Imports and validates a Scenario transactionally.
 *
 * The input is treated as untrusted JSON. It is parsed, deeply checked for plain objects, unsafe
 * property names, finite numbers, supported schema versions, references, and Scenario invariants
 * before a compiled replacement is returned. Failures contain no partial Scenario.
 *
 * @param input - Canonical JSON text or an unknown decoded JSON document.
 * @returns A compiled immutable Scenario on success, or actionable issues on failure.
 */
export function importScenario(input: unknown): ScenarioImportResult {
  const migration = migrateScenario(input);
  if (!migration.ok) {
    return Object.freeze({
      ok: false as const,
      scenario: undefined,
      document: undefined,
      data: undefined,
      serialized: undefined,
      migrated: false as const,
      migratedFrom: migration.fromSchemaVersion,
      issues: migration.issues,
    });
  }
  return Object.freeze({
    ok: true as const,
    scenario: migration.scenario,
    document: migration.document,
    data: migration.document,
    serialized: migration.serialized,
    migrated: migration.migrated,
    migratedFrom:
      migration.migrated && migration.fromSchemaVersion !== CURRENT_SCENARIO_SCHEMA_VERSION
        ? migration.fromSchemaVersion
        : undefined,
    issues: EMPTY_ISSUES,
  });
}

/**
 * Alias for importing a canonical Scenario JSON document.
 */
export const deserializeScenario = importScenario;

/**
 * Alias for migrating a persisted Scenario document.
 */
export const migrateScenarioDocument = migrateScenario;

/**
 * The persistence implementation injected into the public Journey Model factory.
 */
export const scenarioPersistenceAdapter: ScenarioPersistenceAdapter = Object.freeze({
  createScenarioExport,
  serializeScenario,
  exportScenario,
  importScenario,
  migrateScenario,
});

function toCompiledScenario(source: ScenarioExportSource): CompiledScenario {
  if (isCompiledScenario(source)) {
    return source;
  }
  const generatedScenario = compiledScenarioFromGeneratedRegion(source);
  if (generatedScenario !== undefined) {
    return generatedScenario;
  }
  const spreadOwner = exactShallowCloneOwner(source);
  if (spreadOwner !== undefined) {
    return spreadOwner;
  }
  const snapshot = snapshotRawScenarioInput(source);
  if (!isRecord(snapshot)) {
    throw new RangeError("Scenario cannot be exported because its input is not an object.");
  }
  assertRawScenarioConsistency(snapshot);
  const result = compileScenario(snapshot as unknown as ScenarioInput);
  if (!result.ok) {
    throw new RangeError(
      `Scenario cannot be exported because it is invalid:\n${result.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  return result.scenario;
}

function snapshotRawScenarioInput(value: unknown): JsonSnapshot {
  return snapshotScenarioValue(
    value,
    new WeakSet<object>(),
    "$",
    RAW_SCENARIO_INPUT_SNAPSHOT_OPTIONS,
  );
}

/**
 * Recognizes only the object-spread representation of a known compiled owner.
 *
 * This intentionally performs no compile/normalize fallback when a trusted index is present:
 * every own field must be the same data-property value as the index owner, so a changed clone
 * cannot hide an edit behind metadata normalization.
 */
function exactShallowCloneOwner(value: unknown): CompiledScenario | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const indexDescriptor = safeOwnPropertyDescriptor(value, "index", "$.index");
  if (indexDescriptor === undefined) {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(indexDescriptor, "value")) {
    throw new RangeError("Scenario export index must not be an accessor.");
  }
  const index = indexDescriptor.value;
  if (!isTrustedCompiledScenarioIndex(index)) {
    return undefined;
  }
  const owner = getTrustedCompiledScenarioIndexOwner(index);
  if (owner === undefined) {
    throw new RangeError("Scenario export index is trusted but has no owning Scenario.");
  }
  if (!isExactShallowClone(value, owner)) {
    throw new RangeError(
      "Scenario export derived index does not belong to an exact shallow clone of its owner.",
    );
  }
  return owner;
}

function isExactShallowClone(value: object, owner: CompiledScenario): boolean {
  let valuePrototype: object | null;
  try {
    valuePrototype = Object.getPrototypeOf(value);
  } catch {
    throw new RangeError("Scenario export derived Scenario could not be inspected safely.");
  }
  if (valuePrototype !== Object.prototype) {
    return false;
  }
  let ownerKeys: readonly (string | symbol)[];
  let valueKeys: readonly (string | symbol)[];
  try {
    ownerKeys = Reflect.ownKeys(owner);
    valueKeys = Reflect.ownKeys(value);
  } catch {
    throw new RangeError("Scenario export derived Scenario could not be inspected safely.");
  }
  if (ownerKeys.length !== valueKeys.length) {
    return false;
  }
  for (let index = 0; index < ownerKeys.length; index += 1) {
    const ownerKey = ownerKeys[index];
    const valueKey = valueKeys[index];
    if (ownerKey === undefined || valueKey === undefined || ownerKey !== valueKey) {
      return false;
    }
    if (typeof ownerKey === "symbol") {
      return false;
    }
    const ownerDescriptor = safeOwnPropertyDescriptor(owner, ownerKey, `owner.${ownerKey}`);
    const valueDescriptor = safeOwnPropertyDescriptor(value, ownerKey, `$.${ownerKey}`);
    if (
      ownerDescriptor === undefined ||
      valueDescriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(ownerDescriptor, "value") ||
      !Object.prototype.hasOwnProperty.call(valueDescriptor, "value") ||
      !valueDescriptor.enumerable ||
      !Object.is(valueDescriptor.value, ownerDescriptor.value)
    ) {
      return false;
    }
  }
  return true;
}

function assertRawScenarioConsistency(snapshot: RecordValue): void {
  const issues: ScenarioPersistenceIssue[] = [];
  validateMetadataShape(snapshot, issues);
  validateRawPropertyConsistency(snapshot, issues);
  if (issues.length > 0) {
    const issue = issues[0];
    throw new RangeError(
      `${issue?.path ?? "$"}: ${issue?.message ?? "Scenario aliases conflict."}`,
    );
  }
}

function isCompiledScenario(value: unknown): value is CompiledScenario {
  return isTrustedCompiledScenario(value);
}

function compiledScenarioFromGeneratedRegion(value: unknown): CompiledScenario | undefined {
  if (!isTrustedGeneratedClusterRegion(value)) {
    return undefined;
  }
  const candidate = readDataProperty(value, "scenario", "source");
  if (!isCompiledScenario(candidate)) {
    throw new RangeError("Generated Cluster region contains an untrusted compiled Scenario.");
  }
  return candidate;
}

function resolveGenerationMetadata(
  scenario: CompiledScenario,
  options: ScenarioExportOptions,
): {
  readonly generatorVersion: string;
  readonly seed: ScenarioSeed;
  readonly logicalPopulation: number;
} {
  const propertyValue = (property: string): unknown => scenario.properties[property]?.value;
  const generatorAliases = [
    { label: "options.generatorVersion", value: options.generatorVersion },
    { label: "options.generation.generatorVersion", value: options.generation?.generatorVersion },
    { label: "scenario.generatorVersion", value: scenario.generatorVersion },
    { label: "scenario.generation.generatorVersion", value: scenario.generation?.generatorVersion },
    { label: "properties.generatorVersion", value: propertyValue("generatorVersion") },
  ] as const;
  assertGenerationAliasAgreement(generatorAliases, (value) =>
    typeof value === "string" ? value.trim() : value,
  );

  const seedAliases = [
    { label: "options.seed", value: options.seed },
    { label: "options.generation.seed", value: options.generation?.seed },
    { label: "scenario.seed", value: scenario.seed },
    { label: "scenario.generation.seed", value: scenario.generation?.seed },
    { label: "properties.generationSeed", value: propertyValue("generationSeed") },
  ] as const;
  assertGenerationAliasAgreement(seedAliases, (value) => {
    try {
      return createScenarioSeed(value as ScenarioSeedInput).identity;
    } catch (error) {
      throw new RangeError(
        error instanceof Error ? error.message : "Scenario seed metadata is invalid.",
      );
    }
  });

  const populationAliases = [
    { label: "options.logicalPopulation", value: options.logicalPopulation },
    {
      label: "options.generation.logicalPopulation",
      value: options.generation?.logicalPopulation,
    },
    { label: "scenario.logicalPopulation", value: scenario.logicalPopulation },
    {
      label: "scenario.generation.logicalPopulation",
      value: scenario.generation?.logicalPopulation,
    },
    { label: "properties.logicalPopulation", value: propertyValue("logicalPopulation") },
  ] as const;
  assertGenerationAliasAgreement(populationAliases, (value) => value);

  const generatorVersion =
    firstDefined(...generatorAliases.map(({ value }) => value)) ??
    DEFAULT_SCENARIO_GENERATOR_VERSION;
  const seedInput = firstDefined(...seedAliases.map(({ value }) => value));
  const population =
    firstDefined(...populationAliases.map(({ value }) => value)) ?? scenario.systems.length;
  if (typeof generatorVersion !== "string" || generatorVersion.trim().length === 0) {
    throw new RangeError("Scenario export generatorVersion must be a non-empty string.");
  }
  if (!isSupportedScenarioGeneratorVersion(generatorVersion.trim())) {
    throw new RangeError(
      `Unsupported Scenario generatorVersion ${JSON.stringify(generatorVersion.trim())}; supported metadata versions are ${SUPPORTED_SCENARIO_GENERATOR_VERSIONS.join(", ")}.`,
    );
  }
  if (typeof population !== "number" || !Number.isSafeInteger(population) || population < 2) {
    throw new RangeError(
      "Scenario export logicalPopulation must be a safe integer of at least two.",
    );
  }
  let seed: ScenarioSeed;
  try {
    seed = createScenarioSeed(
      seedInput === undefined ? DEFAULT_SCENARIO_SEED : (seedInput as ScenarioSeedInput),
    );
  } catch (error) {
    throw new RangeError(
      error instanceof Error
        ? `Scenario export seed is invalid: ${error.message}`
        : "Scenario export seed is invalid.",
    );
  }
  return Object.freeze({
    generatorVersion: generatorVersion.trim(),
    seed,
    logicalPopulation: population,
  });
}

function assertGenerationAliasAgreement(
  aliases: readonly { readonly label: string; readonly value: unknown }[],
  normalize: (value: unknown) => unknown,
): void {
  const supplied = aliases.filter(({ value }) => value !== undefined);
  const first = supplied[0];
  if (first === undefined || supplied.length < 2) {
    return;
  }
  let normalizedFirst: unknown;
  try {
    normalizedFirst = normalize(first.value);
  } catch (error) {
    throw new RangeError(
      error instanceof Error
        ? `Scenario export ${first.label} is invalid: ${error.message}`
        : `Scenario export ${first.label} is invalid.`,
    );
  }
  for (const alias of supplied.slice(1)) {
    let normalized: unknown;
    try {
      normalized = normalize(alias.value);
    } catch (error) {
      throw new RangeError(
        error instanceof Error
          ? `Scenario export ${alias.label} is invalid: ${error.message}`
          : `Scenario export ${alias.label} is invalid.`,
      );
    }
    if (Object.is(normalizedFirst, normalized) || rawJsonEqual(normalizedFirst, normalized)) {
      continue;
    }
    throw new RangeError(
      `Scenario export metadata aliases ${first.label} and ${alias.label} must agree.`,
    );
  }
}

function normalizeExportJourneyInputs(
  scenario: CompiledScenario,
  options: ScenarioExportOptions,
): readonly SavedJourneyInput[] {
  if (options.journeyInputs !== undefined && options.savedJourneyInputs !== undefined) {
    const journeyInputs = normalizeSavedJourneyInputs(options.journeyInputs);
    const savedJourneyInputs = normalizeSavedJourneyInputs(options.savedJourneyInputs);
    if (canonicalJson(journeyInputs) !== canonicalJson(savedJourneyInputs)) {
      throw new RangeError(
        "Scenario export journeyInputs and savedJourneyInputs must agree when both are supplied.",
      );
    }
    return journeyInputs;
  }
  const inputs = options.journeyInputs ?? options.savedJourneyInputs ?? scenario.journeyInputs;
  return normalizeSavedJourneyInputs(inputs);
}

function normalizeSavedJourneyInputs(
  inputs: readonly SavedJourneyInput[] | undefined,
): readonly SavedJourneyInput[] {
  if (inputs === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(inputs)) {
    throw new RangeError("Scenario journeyInputs must be an array.");
  }
  const snapshots = snapshotDenseArray(
    inputs,
    "journeyInputs",
    new WeakSet<object>(),
    STRICT_SNAPSHOT_OPTIONS,
  );
  return Object.freeze(
    snapshots.map((snapshot, index) => {
      if (!isRecord(snapshot)) {
        throw new RangeError(`journeyInputs[${index}] must be an object.`);
      }
      return snapshot as SavedJourneyInput;
    }),
  );
}

const RAW_ENTITY_PATH =
  /^\$\.(?:systems|orbitalAnchors|gates|gateConnections|shipProfiles)\[\d+\]$/;
const RAW_ANCHOR_PATH = /^\$\.(?:orbitalAnchors|gates)\[\d+\]$/;
const RAW_REFERENCE_PATH = /^\$\.references\[\d+\]$/;
const RAW_OVERRIDE_LAYER_PATH = /^\$\.(?:overrides|overrideLayers)\[\d+\]$/;
const RAW_OVERRIDE_CHANGE_PATH = /^\$\.(?:overrides|overrideLayers)\[\d+\]\.changes\[\d+\]$/;
const RAW_CLAIM_PATH =
  /^(?:\$\.canonicalClaims\[\d+\]\.claim|\$\.(?:overrides|overrideLayers)\[\d+\]\.changes\[\d+\]\.claim|\$\.(?:systems|orbitalAnchors|gates|gateConnections|shipProfiles)\[\d+\]\.(?:properties|propertyProvenance)\.[^.]+\.(?:claim|canonicalClaim))$/;
const RAW_PROPERTY_METADATA_PATH =
  /^(?:\$.properties|\$.propertyProvenance|\$\.(?:systems|orbitalAnchors|gates|gateConnections|shipProfiles)\[\d+\]\.(?:properties|propertyProvenance))\.[^.]+$/;
const RAW_UNCERTAINTY_DISPLAY_PRECISION_PATH = "$.uncertainty.displayPrecision";
const RAW_CANONICAL_IDENTITY_PATH =
  /^(?:\$.canonicalIdentity|\$\.(?:systems|orbitalAnchors|gates|gateConnections|shipProfiles)\[\d+\]\.canonicalIdentity)$/;
const RAW_TOP_LEVEL_OPTIONAL_KEYS = new Set([
  "generatorVersion",
  "seed",
  "logicalPopulation",
  "generation",
  "references",
  "canonicalClaims",
  "overrides",
  "journeyInputs",
  "savedJourneyInputs",
  "canonicalIdentity",
  "provenance",
  "properties",
  "propertyProvenance",
]);
const RAW_ENTITY_OPTIONAL_KEYS = new Set([
  "canonicalIdentity",
  "provenance",
  "properties",
  "propertyProvenance",
]);
const RAW_ANCHOR_OPTIONAL_KEYS = new Set(["parentId", "orbitalElements", "orbit"]);
const RAW_REFERENCE_OPTIONAL_KEYS = new Set([
  "source",
  "locator",
  "title",
  "url",
  "authority",
  "citation",
  "citations",
  "note",
]);
const RAW_PROVENANCE_OPTIONAL_KEYS = new Set([
  "citation",
  "citations",
  "authority",
  "source",
  "note",
  "layerId",
]);
const RAW_CITATION_OPTIONAL_KEYS = new Set(["title", "url", "authority"]);
const RAW_PROPERTY_METADATA_OPTIONAL_KEYS = new Set([
  "claim",
  "canonicalClaim",
  "provenance",
  "value",
  "nominal",
  "selectedNominal",
  "precision",
  "bounds",
  "uncertainty",
]);
const RAW_CANONICAL_IDENTITY_OPTIONAL_KEYS = new Set(["id", "designation", "name", "provenance"]);
const RAW_OVERRIDE_LAYER_OPTIONAL_KEYS = new Set(["parentLayerId", "provenance"]);
const RAW_OVERRIDE_CHANGE_OPTIONAL_KEYS = new Set(["claim", "provenance", "reason"]);
const RAW_PRECISION_OPTIONAL_KEYS = new Set(["significantDigits", "decimalPlaces", "uncertainty"]);
const RAW_SEED_OPTIONAL_KEYS = new Set(["kind", "type", "value", "text", "identity"]);

function isRawPropertyMetadataPath(path: string): boolean {
  return RAW_PROPERTY_METADATA_PATH.test(path);
}

function isRawProvenancePath(path: string): boolean {
  if (path === "$.provenance") {
    return true;
  }
  if (!path.endsWith(".provenance")) {
    return false;
  }
  const parentPath = path.slice(0, -".provenance".length);
  return (
    RAW_ENTITY_PATH.test(parentPath) ||
    RAW_CANONICAL_IDENTITY_PATH.test(parentPath) ||
    RAW_PROPERTY_METADATA_PATH.test(parentPath) ||
    RAW_CLAIM_PATH.test(parentPath) ||
    RAW_OVERRIDE_LAYER_PATH.test(parentPath) ||
    RAW_OVERRIDE_CHANGE_PATH.test(parentPath)
  );
}

function isRawCitationPath(path: string): boolean {
  if (path.endsWith(".citation")) {
    const parentPath = path.slice(0, -".citation".length);
    return isRawProvenancePath(parentPath) || RAW_REFERENCE_PATH.test(parentPath);
  }
  const match = path.match(/^(.*)\.citations\[\d+\]$/);
  if (match === null) {
    return false;
  }
  const parentPath = match[1];
  return (
    parentPath !== undefined &&
    (isRawProvenancePath(parentPath) || RAW_REFERENCE_PATH.test(parentPath))
  );
}

function isRawPrecisionPath(path: string): boolean {
  if (path.endsWith(".displayPrecision")) {
    return (
      isRawPropertyMetadataPath(path.slice(0, -".displayPrecision".length)) ||
      path === RAW_UNCERTAINTY_DISPLAY_PRECISION_PATH
    );
  }
  if (!path.endsWith(".precision")) {
    return false;
  }
  const parentPath = path.slice(0, -".precision".length);
  if (RAW_CLAIM_PATH.test(parentPath) || isRawPropertyMetadataPath(parentPath)) {
    return true;
  }
  return (
    (parentPath.endsWith(".bounds") &&
      isRawPropertyMetadataPath(parentPath.slice(0, -".bounds".length))) ||
    (parentPath.endsWith(".uncertainty") &&
      isRawPropertyMetadataPath(parentPath.slice(0, -".uncertainty".length)))
  );
}

function allowRawScenarioUndefinedProperty(path: string, key: string, _parent: object): boolean {
  if (path === "$") {
    return RAW_TOP_LEVEL_OPTIONAL_KEYS.has(key);
  }
  if (RAW_ENTITY_PATH.test(path)) {
    if (RAW_ENTITY_OPTIONAL_KEYS.has(key)) {
      return true;
    }
    return RAW_ANCHOR_PATH.test(path) && RAW_ANCHOR_OPTIONAL_KEYS.has(key);
  }
  if (RAW_REFERENCE_PATH.test(path)) {
    return RAW_REFERENCE_OPTIONAL_KEYS.has(key);
  }
  if (RAW_OVERRIDE_LAYER_PATH.test(path)) {
    return RAW_OVERRIDE_LAYER_OPTIONAL_KEYS.has(key);
  }
  if (RAW_OVERRIDE_CHANGE_PATH.test(path)) {
    return RAW_OVERRIDE_CHANGE_OPTIONAL_KEYS.has(key);
  }
  if (RAW_CLAIM_PATH.test(path)) {
    if (key !== "value" && key !== "nominal" && key !== "selectedNominal") {
      return false;
    }
    return readDataProperty(parent, "kind", path) === "qualitative";
  }
  if (isRawPropertyMetadataPath(path)) {
    return RAW_PROPERTY_METADATA_OPTIONAL_KEYS.has(key);
  }
  if (RAW_CANONICAL_IDENTITY_PATH.test(path)) {
    return RAW_CANONICAL_IDENTITY_OPTIONAL_KEYS.has(key);
  }
  if (isRawProvenancePath(path)) {
    return RAW_PROVENANCE_OPTIONAL_KEYS.has(key);
  }
  if (isRawCitationPath(path)) {
    return RAW_CITATION_OPTIONAL_KEYS.has(key);
  }
  if (isRawPrecisionPath(path)) {
    return RAW_PRECISION_OPTIONAL_KEYS.has(key);
  }
  if (path === "$.seed" || path === "$.generation.seed") {
    return RAW_SEED_OPTIONAL_KEYS.has(key);
  }
  return false;
}

function omitRawScenarioDerivedProperty(
  path: string,
  key: string,
  value: unknown,
  _parent: object,
): boolean {
  if (path !== "$") {
    return false;
  }
  if (key === "index") {
    return isTrustedCompiledScenarioIndex(value);
  }
  if (key === "overrideBase") {
    throw new RangeError(
      "Scenario export overrideBase requires an exact shallow clone of a trusted Scenario.",
    );
  }
  return false;
}

function readCanonicalArrayEntries(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new RangeError(`${path} must be an array.`);
  }
  const objectValue = value as object;
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(objectValue);
  } catch {
    throw new RangeError(`${path} could not be inspected safely.`);
  }
  if (prototype !== Array.prototype && prototype !== null) {
    throw new RangeError(`${path} must contain a plain array.`);
  }
  const lengthDescriptor = safeOwnPropertyDescriptor(value, "length", `${path}.length`);
  if (lengthDescriptor === undefined) {
    throw new RangeError(`${path}.length could not be inspected safely.`);
  }
  if (!Object.prototype.hasOwnProperty.call(lengthDescriptor, "value")) {
    throw new RangeError(`${path}.length must not be an accessor.`);
  }
  const length = lengthDescriptor.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw new RangeError(`${path}.length must be a safe non-negative integer.`);
  }
  let keys: readonly (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new RangeError(`${path} could not be inspected safely.`);
  }
  for (const key of keys) {
    if (typeof key === "symbol") {
      throw new RangeError(`${path} must not contain symbol properties.`);
    }
    if (key === "length") {
      continue;
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
      throw new RangeError(`${path}.${key} must be a canonical array index.`);
    }
    const descriptor = safeOwnPropertyDescriptor(value, key, `${path}.${key}`);
    if (descriptor === undefined) {
      throw new RangeError(`${path}.${key} could not be inspected safely.`);
    }
    if (!descriptor.enumerable) {
      throw new RangeError(`${path}.${key} must be an enumerable data property.`);
    }
    if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      throw new RangeError(`${path}.${key} must not be an accessor.`);
    }
  }
  const entries: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    const descriptor = safeOwnPropertyDescriptor(value, key, `${path}[${index}]`);
    if (descriptor === undefined) {
      throw new RangeError(`${path}[${index}] must not be a sparse array hole.`);
    }
    if (!descriptor.enumerable) {
      throw new RangeError(`${path}[${index}] must be an enumerable data property.`);
    }
    if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      throw new RangeError(`${path}[${index}] must not be an accessor.`);
    }
    entries.push(descriptor.value);
  }
  return Object.freeze(entries);
}

function snapshotDenseArray(
  value: unknown,
  path: string,
  active: WeakSet<object> = new WeakSet<object>(),
  options: SnapshotOptions = STRICT_SNAPSHOT_OPTIONS,
): readonly JsonSnapshot[] {
  const entries = readCanonicalArrayEntries(value, path);
  const objectValue = value as object;
  if (active.has(objectValue)) {
    throw new RangeError(`${path} must not contain cyclic values.`);
  }
  active.add(objectValue);
  try {
    return Object.freeze(
      entries.map((entry, index) =>
        snapshotScenarioValue(entry, active, `${path}[${index}]`, options),
      ),
    );
  } finally {
    active.delete(objectValue);
  }
}

function snapshotScenarioValue(
  value: unknown,
  active: WeakSet<object> = new WeakSet<object>(),
  path = "$",
  options: SnapshotOptions = STRICT_SNAPSHOT_OPTIONS,
): JsonSnapshot {
  if (value === undefined) {
    throw new RangeError(`${path} must not contain undefined values.`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${path} must contain only finite numbers.`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new RangeError(`${path} must contain only JSON-compatible values.`);
  }
  const objectValue = value as object;
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(objectValue);
  } catch {
    throw new RangeError(`${path} could not be inspected safely.`);
  }
  if (
    prototype !== Object.prototype &&
    prototype !== null &&
    !(Array.isArray(value) && prototype === Array.prototype)
  ) {
    throw new RangeError(`${path} must contain plain JSON objects or arrays.`);
  }
  if (Array.isArray(value)) {
    return snapshotDenseArray(value, path, active, options);
  }
  if (active.has(objectValue)) {
    throw new RangeError(`${path} must not contain cyclic values.`);
  }
  active.add(objectValue);
  try {
    let keys: readonly (string | symbol)[];
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      throw new RangeError(`${path} could not be inspected safely.`);
    }
    const copy = Object.create(null) as RecordValue;
    for (const key of keys) {
      if (typeof key === "symbol") {
        throw new RangeError(`${path} must not contain symbol properties.`);
      }
      if (UNSAFE_KEYS.has(key)) {
        throw new RangeError(`${path}.${key} is not allowed in Scenario JSON.`);
      }
      const descriptor = safeOwnPropertyDescriptor(value, key, `${path}.${key}`);
      if (descriptor === undefined) {
        throw new RangeError(`${path}.${key} could not be inspected safely.`);
      }
      if (!descriptor.enumerable) {
        throw new RangeError(`${path}.${key} must be an enumerable data property.`);
      }
      if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        throw new RangeError(`${path}.${key} must not be an accessor.`);
      }
      if (options.omitObjectProperty?.(path, key, descriptor.value, value) === true) {
        continue;
      }
      if (
        descriptor.value === undefined &&
        (options.allowUndefinedObjectProperties ||
          options.allowUndefinedObjectProperty?.(path, key, value) === true)
      ) {
        continue;
      }
      copy[key] = snapshotScenarioValue(descriptor.value, active, `${path}.${key}`, options);
    }
    return Object.freeze(copy);
  } finally {
    active.delete(objectValue);
  }
}

function requiredExportText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`Scenario export ${path} must be a non-empty string.`);
  }
  return value;
}

function snapshotRequiredRecord(value: unknown, path: string): RecordValue {
  const snapshot = snapshotScenarioValue(
    value,
    new WeakSet<object>(),
    path,
    OMIT_UNDEFINED_SNAPSHOT_OPTIONS,
  );
  if (!isRecord(snapshot)) {
    throw new RangeError(`Scenario export ${path} must be a JSON object.`);
  }
  return snapshot;
}

function snapshotRecordArray(value: unknown, path: string): readonly RecordValue[] {
  const entries = snapshotDenseArray(
    value,
    path,
    new WeakSet<object>(),
    OMIT_UNDEFINED_SNAPSHOT_OPTIONS,
  );
  const snapshots: RecordValue[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const snapshot = entries[index];
    if (!isRecord(snapshot)) {
      throw new RangeError(`Scenario export ${path}[${index}] must be a JSON object.`);
    }
    snapshots.push(snapshot);
  }
  return Object.freeze(snapshots);
}

function snapshotRecordsById<T extends { readonly id: string }>(
  values: readonly T[],
  path: string,
): readonly T[] {
  const entries = snapshotDenseArray(
    values,
    path,
    new WeakSet<object>(),
    OMIT_UNDEFINED_SNAPSHOT_OPTIONS,
  );
  const snapshots: RecordValue[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const snapshot = entries[index];
    if (!isRecord(snapshot) || typeof snapshot.id !== "string" || snapshot.id.trim().length === 0) {
      throw new RangeError(`Scenario export ${path}[${index}] must contain a non-empty id.`);
    }
    snapshots.push(snapshot);
  }
  return sortEntities(snapshots as unknown as readonly T[]);
}

function snapshotScenarioReferences(
  values: readonly ScenarioReference[],
): readonly ScenarioReference[] {
  const references = snapshotRecordsById(values, "references");
  return sortReferences(
    references.map((reference, index) => {
      try {
        const normalized = createScenarioReference(reference as unknown as ScenarioReferenceInput);
        return snapshotScenarioValue(
          normalized,
          new WeakSet<object>(),
          `references[${index}]`,
          OMIT_UNDEFINED_SNAPSHOT_OPTIONS,
        ) as ScenarioReference;
      } catch (error) {
        throw new RangeError(
          error instanceof Error
            ? `Scenario export references[${index}] is invalid: ${error.message}`
            : `Scenario export references[${index}] is invalid.`,
        );
      }
    }),
  );
}

function validateCanonicalClaimValues(values: readonly ScenarioCanonicalClaim[]): void {
  const entries = readCanonicalArrayEntries(values, "canonicalClaims");
  for (let index = 0; index < entries.length; index += 1) {
    const value = entries[index];
    const recordPath = `canonicalClaims[${index}]`;
    const path = `${recordPath}.claim`;
    if (!isRecord(value)) {
      throw new RangeError(`${path} must be an object.`);
    }
    validateCanonicalClaimValue(readDataProperty(value, "claim", recordPath), path);
  }
}

function validateCanonicalClaimValue(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw new RangeError(`${path} must be an object.`);
  }
  const kind = readDataProperty(value, "kind", path);
  if (kind === "exact") {
    const exactValue = readDataProperty(value, "value", path);
    snapshotScenarioValue(exactValue, new WeakSet<object>(), `${path}.value`);
    return;
  }
  if (kind === "range") {
    for (const key of ["lower", "upper", "nominal"] as const) {
      const bound = readDataProperty(value, key, path);
      snapshotScenarioValue(bound, new WeakSet<object>(), `${path}.${key}`);
    }
  }
}

function validateOverrideValues(values: readonly ScenarioOverrideLayer[]): void {
  const layers = readCanonicalArrayEntries(values, "overrides");
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    const layerPath = `overrides[${layerIndex}]`;
    if (!isRecord(layer)) {
      throw new RangeError(`${layerPath} must be an object.`);
    }
    const changes = readDataProperty(layer, "changes", layerPath);
    const changeEntries = readCanonicalArrayEntries(changes, `${layerPath}.changes`);
    for (let changeIndex = 0; changeIndex < changeEntries.length; changeIndex += 1) {
      const change = changeEntries[changeIndex];
      const changePath = `${layerPath}.changes[${changeIndex}]`;
      if (!isRecord(change)) {
        throw new RangeError(`${changePath} must be an object.`);
      }
      const changeValue = readDataProperty(change, "value", changePath);
      snapshotScenarioValue(changeValue, new WeakSet<object>(), `${changePath}.value`);
      const claim = readDataProperty(change, "claim", changePath);
      if (claim !== undefined) {
        validateCanonicalClaimValue(claim, `${changePath}.claim`);
      }
    }
  }
}

function validateEntityPropertyMetadata(
  values: readonly { readonly properties: unknown }[],
  path: string,
): void {
  const entries = readCanonicalArrayEntries(values, path);
  for (let index = 0; index < entries.length; index += 1) {
    const value = entries[index];
    const entityPath = `${path}[${index}]`;
    if (!isRecord(value)) {
      throw new RangeError(`${entityPath} must be an object.`);
    }
    validatePropertyMetadataValues(
      readDataProperty(value, "properties", entityPath),
      `${entityPath}.properties`,
    );
    validatePropertyMetadataValues(
      readDataProperty(value, "propertyProvenance", entityPath),
      `${entityPath}.propertyProvenance`,
    );
  }
}

function validatePropertyMetadataValues(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw new RangeError(`${path} must be an object.`);
  }
  let keys: readonly (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new RangeError(`${path} could not be inspected safely.`);
  }
  for (const key of keys) {
    if (typeof key === "symbol") {
      throw new RangeError(`${path} must not contain symbol properties.`);
    }
    if (UNSAFE_KEYS.has(key)) {
      throw new RangeError(`${path}.${key} is not allowed in Scenario JSON.`);
    }
    const metadata = readDataProperty(value, key, path);
    if (!isRecord(metadata)) {
      throw new RangeError(`${path}.${key} must be an object.`);
    }
    for (const property of ["value", "nominal", "selectedNominal", "bounds"] as const) {
      const propertyValue = readDataProperty(metadata, property, `${path}.${key}`);
      if (propertyValue !== undefined) {
        snapshotScenarioValue(propertyValue, new WeakSet<object>(), `${path}.${key}.${property}`);
      }
    }
    for (const property of ["claim", "canonicalClaim"] as const) {
      const claim = readDataProperty(metadata, property, `${path}.${key}`);
      if (claim !== undefined) {
        validateCanonicalClaimValue(claim, `${path}.${key}.${property}`);
      }
    }
  }
}

function safeOwnPropertyDescriptor(
  value: object,
  key: string,
  path: string,
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    throw new RangeError(`${path} could not be inspected safely.`);
  }
}

function readDataProperty(record: object, key: string, path: string): unknown {
  const descriptor = safeOwnPropertyDescriptor(record, key, `${path}.${key}`);
  if (descriptor === undefined) {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw new RangeError(`${path}.${key} must not be an accessor.`);
  }
  return descriptor.value;
}

function snapshotCanonicalClaims(
  values: readonly ScenarioCanonicalClaim[],
): readonly ScenarioCanonicalClaim[] {
  validateCanonicalClaimValues(values);
  const claims = snapshotRecordsById(values, "canonicalClaims");
  for (const [index, claim] of claims.entries()) {
    const record = claim as unknown as RecordValue;
    if (
      typeof record.subject !== "string" ||
      record.subject.trim().length === 0 ||
      typeof record.property !== "string" ||
      record.property.trim().length === 0
    ) {
      throw new RangeError(
        `Scenario export canonicalClaims[${index}] requires subject and property.`,
      );
    }
    const canonicalClaim = record.claim;
    if (!isRecord(canonicalClaim) || typeof canonicalClaim.kind !== "string") {
      throw new RangeError(`Scenario export canonicalClaims[${index}].claim is invalid.`);
    }
    if (!isRecord(canonicalClaim.provenance)) {
      throw new RangeError(
        `Scenario export canonicalClaims[${index}].claim.provenance must be an object.`,
      );
    }
    if (canonicalClaim.kind === "exact") {
      if (
        !Object.prototype.hasOwnProperty.call(canonicalClaim, "value") ||
        canonicalClaim.value === undefined
      ) {
        throw new RangeError(
          `Scenario export canonicalClaims[${index}].claim.value must be JSON-safe.`,
        );
      }
      continue;
    }
    if (canonicalClaim.kind === "range") {
      for (const key of ["lower", "upper", "nominal"] as const) {
        if (
          !Object.prototype.hasOwnProperty.call(canonicalClaim, key) ||
          canonicalClaim[key] === undefined
        ) {
          throw new RangeError(
            `Scenario export canonicalClaims[${index}].claim.${key} must be JSON-safe.`,
          );
        }
      }
      continue;
    }
    if (canonicalClaim.kind !== "qualitative" || typeof canonicalClaim.statement !== "string") {
      throw new RangeError(`Scenario export canonicalClaims[${index}].claim is invalid.`);
    }
  }
  return claims;
}

function sortEntities<T extends { readonly id: string }>(values: readonly T[]): readonly T[] {
  return Object.freeze(
    [...values].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
  );
}

function sortReferences(values: readonly ScenarioReference[]): readonly ScenarioReference[] {
  return sortEntities(values);
}

function canonicalJson(value: unknown): string {
  const safeValue = snapshotScenarioValue(
    value,
    new WeakSet<object>(),
    "$",
    STRICT_SNAPSHOT_OPTIONS,
  );
  const normalized = canonicalize(safeValue, "$", new WeakSet<object>());
  const serialized = JSON.stringify(normalized);
  if (serialized === undefined) {
    throw new RangeError("Scenario document could not be serialized as JSON.");
  }
  return serialized;
}

function canonicalize(value: unknown, path: string, seen: WeakSet<object>): unknown {
  if (value === undefined) {
    throw new RangeError(`${path} must not contain undefined values.`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${path} must contain only finite numbers.`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new RangeError(`${path} must contain only JSON-compatible values.`);
  }
  if (seen.has(value)) {
    throw new RangeError(`${path} must not contain cyclic values.`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((child, index) => {
      const normalized = canonicalize(child, `${path}[${index}]`, seen);
      if (normalized === undefined) {
        throw new RangeError(`${path}[${index}] cannot be undefined.`);
      }
      return normalized;
    });
    seen.delete(value);
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RangeError(`${path} must contain plain JSON objects.`);
  }
  const result: RecordValue = Object.create(null);
  for (const key of Object.keys(value as RecordValue).sort()) {
    if (UNSAFE_KEYS.has(key)) {
      throw new RangeError(`${path}.${key} is not allowed in Scenario JSON.`);
    }
    const normalized = canonicalize((value as RecordValue)[key], `${path}.${key}`, seen);
    if (normalized !== undefined) {
      result[key] = normalized;
    }
  }
  seen.delete(value);
  return result;
}

function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const child of value) {
      deepFreeze(child, seen);
    }
  } else {
    for (const child of Object.values(value as RecordValue)) {
      deepFreeze(child, seen);
    }
  }
  return Object.freeze(value);
}

function parseDocument(
  input: unknown,
):
  | { readonly ok: true; readonly value: RecordValue }
  | { readonly ok: false; readonly issues: readonly ScenarioPersistenceIssue[] } {
  let decoded: unknown;
  if (typeof input === "string") {
    try {
      decoded = JSON.parse(input) as unknown;
    } catch (error) {
      return {
        ok: false,
        issues: Object.freeze([
          persistenceIssue(
            "invalid-json",
            "$",
            error instanceof Error
              ? `Scenario JSON is invalid: ${error.message}`
              : "Scenario JSON is invalid.",
            "valid JSON object text",
            undefined,
          ),
        ]),
      };
    }
  } else {
    decoded = input;
  }
  if (!isRecord(decoded)) {
    return {
      ok: false,
      issues: Object.freeze([
        persistenceIssue(
          "invalid-document",
          "$",
          "Scenario import requires a JSON object or JSON object text.",
          "a JSON object",
          typeof decoded,
        ),
      ]),
    };
  }
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(decoded);
  } catch {
    return {
      ok: false,
      issues: Object.freeze([
        persistenceIssue(
          "invalid-document",
          "$",
          "Scenario import could not inspect the document safely.",
          "a plain JSON object",
          "uninspectable object",
        ),
      ]),
    };
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return {
      ok: false,
      issues: Object.freeze([
        persistenceIssue(
          "prototype-pollution",
          "$",
          "Scenario import accepts only plain JSON objects; custom prototypes are rejected.",
          "a plain JSON object",
          prototype === null ? "null" : "custom prototype",
        ),
      ]),
    };
  }
  try {
    const snapshot = snapshotScenarioValue(
      decoded,
      new WeakSet<object>(),
      "$",
      STRICT_SNAPSHOT_OPTIONS,
    );
    if (!isRecord(snapshot)) {
      throw new RangeError("Scenario import requires a JSON object.");
    }
    return { ok: true, value: snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scenario document is not safe JSON.";
    const code =
      message.includes("not allowed") || message.includes("prototype")
        ? "prototype-pollution"
        : message.includes("finite")
          ? "non-finite-number"
          : "invalid-document";
    const path = message.match(/^(\$[^ ]*) /)?.[1] ?? "$";
    return {
      ok: false,
      issues: Object.freeze([persistenceIssue(code, path, message, "safe JSON values", undefined)]),
    };
  }
}

function readSchemaVersion(value: RecordValue):
  | { readonly ok: true; readonly version: number }
  | {
      readonly ok: false;
      readonly version: number | undefined;
      readonly issues: readonly ScenarioPersistenceIssue[];
    } {
  const hasSchemaVersion = Object.prototype.hasOwnProperty.call(value, "schemaVersion");
  const hasLegacyVersion = Object.prototype.hasOwnProperty.call(value, "version");
  const rawVersion = hasSchemaVersion
    ? value.schemaVersion
    : hasLegacyVersion
      ? value.version
      : undefined;
  if (
    hasSchemaVersion &&
    hasLegacyVersion &&
    (typeof value.schemaVersion !== "number" || value.schemaVersion !== value.version)
  ) {
    return {
      ok: false,
      version: typeof value.schemaVersion === "number" ? value.schemaVersion : undefined,
      issues: Object.freeze([
        persistenceIssue(
          "invalid-schema-version",
          "schemaVersion",
          "schemaVersion and legacy version fields must agree when both are present.",
          "matching schema version fields",
          typeof value.schemaVersion,
        ),
      ]),
    };
  }
  if (typeof rawVersion !== "number" || !Number.isSafeInteger(rawVersion)) {
    return {
      ok: false,
      version: undefined,
      issues: Object.freeze([
        persistenceIssue(
          "invalid-schema-version",
          "schemaVersion",
          "schemaVersion must be a safe integer.",
          "a safe integer schema version",
          typeof rawVersion,
        ),
      ]),
    };
  }
  return { ok: true, version: rawVersion };
}

function migrateV1Document(
  value: RecordValue,
):
  | { readonly ok: true; readonly value: RecordValue }
  | { readonly ok: false; readonly issues: readonly ScenarioPersistenceIssue[] } {
  if (value.kind !== undefined && value.kind !== SCENARIO_KIND) {
    return {
      ok: false,
      issues: Object.freeze([
        persistenceIssue(
          "invalid-document",
          "kind",
          `kind must be ${SCENARIO_KIND}.`,
          SCENARIO_KIND,
          typeof value.kind === "string" ? value.kind : typeof value.kind,
        ),
      ]),
    };
  }
  const nested = value.scenario;
  if (nested !== undefined && !isRecord(nested)) {
    return {
      ok: false,
      issues: Object.freeze([
        persistenceIssue(
          "migration-failed",
          "scenario",
          "v1 scenario must be an object when supplied.",
          "a JSON object",
          typeof nested,
        ),
      ]),
    };
  }
  const scenario = isRecord(nested) ? nested : value;
  const aliasIssues: ScenarioPersistenceIssue[] = [];
  validatePersistedAliases(value, aliasIssues);
  if (scenario !== value) {
    validatePersistedAliases(scenario, aliasIssues);
  }
  validateMigrationAliases(value, scenario, aliasIssues);
  if (aliasIssues.length > 0) {
    return { ok: false, issues: Object.freeze(aliasIssues) };
  }
  if (scenario.kind !== undefined && scenario.kind !== SCENARIO_KIND) {
    return {
      ok: false,
      issues: Object.freeze([
        persistenceIssue(
          "invalid-document",
          "scenario.kind",
          `scenario.kind must be ${SCENARIO_KIND}.`,
          SCENARIO_KIND,
          typeof scenario.kind === "string" ? scenario.kind : typeof scenario.kind,
        ),
      ]),
    };
  }
  const generator = isRecord(value.generator)
    ? value.generator
    : isRecord(value.generation)
      ? value.generation
      : isRecord(scenario.generation)
        ? scenario.generation
        : undefined;
  const result: RecordValue = Object.create(null);
  result.kind = SCENARIO_KIND;
  result.schemaVersion = CURRENT_SCENARIO_SCHEMA_VERSION;
  result.generatorVersion = firstDefined(
    value.generatorVersion,
    generator?.generatorVersion,
    generator?.version,
    scenario.generatorVersion,
  );
  const legacySeed = firstDefined(value.seed, generator?.seed, scenario.seed);
  try {
    result.seed = createScenarioSeed(
      legacySeed === undefined ? DEFAULT_SCENARIO_SEED : (legacySeed as ScenarioSeedInput),
    );
  } catch {
    result.seed = legacySeed;
  }
  result.logicalPopulation = firstDefined(
    value.logicalPopulation,
    value.population,
    generator?.logicalPopulation,
    generator?.population,
    scenario.logicalPopulation,
    scenario.population,
  );
  result.id = firstDefined(scenario.id, value.id);
  result.designation = firstDefined(scenario.designation, value.designation);
  result.name = firstDefined(scenario.name, value.name);
  result.epoch = migrateV1Epoch(firstDefined(scenario.epoch, value.epoch));
  result.systems = firstDefined(scenario.systems, value.systems);
  result.orbitalAnchors = firstDefined(
    scenario.orbitalAnchors,
    scenario.anchors,
    value.orbitalAnchors,
    value.anchors,
  );
  result.gates = firstDefined(scenario.gates, value.gates);
  result.gateConnections = firstDefined(
    scenario.gateConnections,
    scenario.connections,
    value.gateConnections,
    value.connections,
  );
  result.shipProfiles = firstDefined(
    scenario.shipProfiles,
    scenario.profiles,
    value.shipProfiles,
    value.profiles,
  );
  result.references = firstDefined(
    scenario.references,
    scenario.sourceReferences,
    value.references,
    value.sourceReferences,
    value.citations,
  );
  result.canonicalClaims = firstDefined(
    scenario.canonicalClaims,
    scenario.claims,
    value.canonicalClaims,
    value.claims,
  );
  result.overrides = firstDefined(
    scenario.overrides,
    scenario.overrideLayers,
    value.overrides,
    value.overrideLayers,
  );
  result.journeyInputs = firstDefined(
    scenario.journeyInputs,
    scenario.savedJourneyInputs,
    scenario.journeys,
    value.journeyInputs,
    value.savedJourneyInputs,
    value.journeys,
  );
  result.canonicalIdentity = firstDefined(scenario.canonicalIdentity, value.canonicalIdentity);
  result.provenance = firstDefined(scenario.provenance, value.provenance);
  result.properties = firstDefined(scenario.properties, value.properties);
  result.propertyProvenance = firstDefined(scenario.propertyProvenance, value.propertyProvenance);

  if (result.generatorVersion === undefined) {
    result.generatorVersion = DEFAULT_SCENARIO_GENERATOR_VERSION;
  }
  if (result.seed === undefined) {
    result.seed = DEFAULT_SCENARIO_SEED;
  }
  if (result.logicalPopulation === undefined && Array.isArray(result.systems)) {
    result.logicalPopulation = result.systems.length;
  }
  if (result.references !== undefined && isRecord(result.references)) {
    result.references = [result.references];
  }
  if (Array.isArray(result.references) && result.references.every((entry) => isRecord(entry))) {
    result.references = result.references.map((entry, index) => {
      if (typeof entry.id === "string" && entry.id.length > 0) {
        return entry;
      }
      return { ...entry, id: `reference:v1:${String(index + 1).padStart(4, "0")}` };
    });
  }
  for (const key of [
    "systems",
    "orbitalAnchors",
    "gates",
    "gateConnections",
    "shipProfiles",
  ] as const) {
    if (result[key] === undefined) {
      result[key] = [];
    }
  }
  if (result.references === undefined) {
    result.references = [];
  }
  if (result.canonicalClaims === undefined) {
    result.canonicalClaims = [];
  }
  if (result.overrides === undefined) {
    result.overrides = [];
  }
  if (result.journeyInputs === undefined) {
    result.journeyInputs = [];
  }
  return { ok: true, value: Object.freeze(result) };
}

function migrateV1Epoch(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  if (typeof value.coordinateTime === "number") {
    return {
      ...value,
      coordinateTime: { value: value.coordinateTime, unit: "s" },
    };
  }
  return value;
}

function validateCurrentGenerationAliases(
  document: RecordValue,
  issues: ScenarioPersistenceIssue[],
): void {
  const generation = document.generation;
  if (generation === undefined) {
    return;
  }
  if (!isRecord(generation)) {
    issues.push(
      persistenceIssue(
        "invalid-generation-metadata",
        "generation",
        "generation must be an object when supplied.",
        "a generation metadata object",
        typeof generation,
      ),
    );
    return;
  }
  validatePersistedGenerationAliases(
    [
      { label: "generatorVersion", value: document.generatorVersion },
      { label: "generation.generatorVersion", value: generation.generatorVersion },
    ],
    "generatorVersion",
    (value) => (typeof value === "string" ? value.trim() : value),
    issues,
  );
  validatePersistedGenerationAliases(
    [
      { label: "logicalPopulation", value: document.logicalPopulation },
      { label: "generation.logicalPopulation", value: generation.logicalPopulation },
    ],
    "logicalPopulation",
    (value) => value,
    issues,
  );
  validatePersistedGenerationAliases(
    [
      { label: "seed", value: document.seed },
      { label: "generation.seed", value: generation.seed },
    ],
    "seed",
    (value) => {
      try {
        return createScenarioSeed(value as ScenarioSeedInput).identity;
      } catch {
        return undefined;
      }
    },
    issues,
  );
}

function validatePersistedGenerationAliases(
  aliases: readonly { readonly label: string; readonly value: unknown }[],
  field: "generatorVersion" | "logicalPopulation" | "seed",
  normalize: (value: unknown) => unknown,
  issues: ScenarioPersistenceIssue[],
): void {
  const supplied = aliases.filter(({ value }) => value !== undefined);
  const first = supplied[0];
  if (first === undefined || supplied.length < 2) {
    return;
  }
  let normalizedFirst: unknown;
  try {
    normalizedFirst = normalize(first.value);
  } catch {
    return;
  }
  for (const alias of supplied.slice(1)) {
    let normalized: unknown;
    try {
      normalized = normalize(alias.value);
    } catch {
      return;
    }
    if (normalized === undefined || normalizedFirst === undefined) {
      continue;
    }
    if (Object.is(normalizedFirst, normalized) || rawJsonEqual(normalizedFirst, normalized)) {
      continue;
    }
    issues.push(
      persistenceIssue(
        "invalid-generation-metadata",
        field,
        `${first.label} and ${alias.label} must agree when both are supplied.`,
        "matching generation metadata aliases",
        "conflicting generation metadata aliases",
      ),
    );
  }
}

function normalizeCurrentDocument(
  value: RecordValue,
  requireTypedSeed = false,
):
  | { readonly ok: true; readonly value: RecordValue }
  | { readonly ok: false; readonly issues: readonly ScenarioPersistenceIssue[] } {
  const issues: ScenarioPersistenceIssue[] = [];
  if (value.kind !== undefined && value.kind !== SCENARIO_KIND) {
    issues.push(
      persistenceIssue(
        "invalid-document",
        "kind",
        `kind must be ${SCENARIO_KIND}.`,
        SCENARIO_KIND,
        typeof value.kind === "string" ? value.kind : typeof value.kind,
      ),
    );
  }
  if (value.schemaVersion !== CURRENT_SCENARIO_SCHEMA_VERSION) {
    issues.push(
      persistenceIssue(
        "invalid-schema-version",
        "schemaVersion",
        `Migrated Scenario must have schemaVersion ${CURRENT_SCENARIO_SCHEMA_VERSION}.`,
        String(CURRENT_SCENARIO_SCHEMA_VERSION),
        String(value.schemaVersion),
      ),
    );
  }
  validateCurrentGenerationAliases(value, issues);

  const generatorVersion = value.generatorVersion;
  if (typeof generatorVersion !== "string" || generatorVersion.trim().length === 0) {
    issues.push(
      persistenceIssue(
        "invalid-generation-metadata",
        "generatorVersion",
        "generatorVersion must be a non-empty string.",
        "a non-empty string",
        typeof generatorVersion,
      ),
    );
  } else if (!isSupportedScenarioGeneratorVersion(generatorVersion.trim())) {
    issues.push(
      persistenceIssue(
        "unsupported-generator-version",
        "generatorVersion",
        `generatorVersion ${JSON.stringify(generatorVersion.trim())} is unavailable; supported metadata versions are ${SUPPORTED_SCENARIO_GENERATOR_VERSIONS.join(", ")}.`,
        SUPPORTED_SCENARIO_GENERATOR_VERSIONS.join(", "),
        generatorVersion.trim(),
      ),
    );
  }

  let seed: ScenarioSeed | undefined;
  try {
    if (requireTypedSeed && !isRecord(value.seed)) {
      throw new RangeError("Current Scenario schema requires a typed seed descriptor object.");
    }
    seed = createScenarioSeed(value.seed as ScenarioSeedInput);
  } catch (error) {
    issues.push(
      persistenceIssue(
        "invalid-seed",
        "seed",
        error instanceof Error ? error.message : "seed is invalid.",
        "a typed safe-integer or exact-text seed",
        typeof value.seed,
      ),
    );
  }

  const seedIdentity = value.seedIdentity;
  const seedText = value.seedText;
  if (seed !== undefined) {
    if (seedIdentity !== undefined && seedIdentity !== seed.identity) {
      issues.push(
        persistenceIssue(
          "invalid-seed",
          "seedIdentity",
          "seedIdentity must match the typed seed identity.",
          seed.identity,
          typeof seedIdentity === "string" ? seedIdentity : typeof seedIdentity,
        ),
      );
    }
    if (seedText !== undefined && seedText !== seed.text) {
      issues.push(
        persistenceIssue(
          "invalid-seed",
          "seedText",
          "seedText must preserve the exact typed seed text.",
          seed.text,
          typeof seedText === "string" ? seedText : typeof seedText,
        ),
      );
    }
  }

  const logicalPopulation = value.logicalPopulation;
  if (
    typeof logicalPopulation !== "number" ||
    !Number.isSafeInteger(logicalPopulation) ||
    logicalPopulation < 2
  ) {
    issues.push(
      persistenceIssue(
        "invalid-generation-metadata",
        "logicalPopulation",
        "logicalPopulation must be a safe integer of at least two.",
        "a safe integer >= 2",
        typeof logicalPopulation,
      ),
    );
  }

  const requiredTexts = ["id", "designation", "name"] as const;
  for (const key of requiredTexts) {
    if (typeof value[key] !== "string" || value[key].trim().length === 0) {
      issues.push(
        persistenceIssue(
          "invalid-document",
          key,
          `${key} must be a non-empty string.`,
          "a non-empty string",
          typeof value[key],
        ),
      );
    }
  }
  if (!isValidEpoch(value.epoch)) {
    issues.push(
      persistenceIssue(
        "invalid-document",
        "epoch",
        "epoch must contain a non-empty label and a finite seconds quantity.",
        '{ label, coordinateTime: { value, unit: "s" } }',
        typeof value.epoch,
      ),
    );
  }

  const persistedArrays = {
    systems: value.systems,
    orbitalAnchors: selectPersistedAlias(value, "orbitalAnchors", "anchors"),
    gates: value.gates,
    gateConnections: selectPersistedAlias(value, "gateConnections", "connections"),
    shipProfiles: selectPersistedAlias(value, "shipProfiles", "profiles"),
    references: selectPersistedAlias(value, "references", "sourceReferences"),
    canonicalClaims: selectPersistedAlias(value, "canonicalClaims", "claims"),
    overrides: selectPersistedAlias(value, "overrides", "overrideLayers"),
    journeyInputs: selectPersistedAlias(value, "journeyInputs", "savedJourneyInputs"),
  } as const;
  for (const [key, arrayValue] of Object.entries(persistedArrays)) {
    if (!Array.isArray(arrayValue)) {
      issues.push(
        persistenceIssue(
          key === "journeyInputs" ? "invalid-journey-input" : "invalid-document",
          key,
          `${key} must be an array.`,
          "an array",
          typeof arrayValue,
        ),
      );
    }
  }
  for (const [key, arrayValue] of Object.entries(persistedArrays)) {
    if (Array.isArray(arrayValue)) {
      validateRecordArray(arrayValue, key, issues);
    }
  }
  validateRawPropertyConsistency(value, issues);
  validateMetadataShape(value, issues);

  const references = normalizeReferences(persistedArrays.references, issues);
  const journeyInputs = normalizeImportedJourneyInputs(persistedArrays.journeyInputs, issues);
  if (issues.length > 0) {
    return { ok: false, issues: Object.freeze(issues) };
  }

  const document: RecordValue = Object.create(null);
  document.kind = SCENARIO_KIND;
  document.schemaVersion = CURRENT_SCENARIO_SCHEMA_VERSION;
  document.generatorVersion = (generatorVersion as string).trim();
  document.seed = seed;
  document.seedIdentity = seed?.identity;
  document.seedText = seed?.text;
  document.logicalPopulation = logicalPopulation;
  document.id = value.id;
  document.designation = value.designation;
  document.name = value.name;
  document.epoch = value.epoch;
  document.systems = sortRawEntities(persistedArrays.systems);
  document.orbitalAnchors = normalizeRawAnchors(persistedArrays.orbitalAnchors);
  document.gates = sortRawEntities(persistedArrays.gates);
  document.gateConnections = sortRawEntities(persistedArrays.gateConnections);
  document.shipProfiles = sortRawEntities(persistedArrays.shipProfiles);
  document.references = references;
  document.canonicalClaims = sortRawEntities(persistedArrays.canonicalClaims, false);
  document.overrides = persistedArrays.overrides;
  document.journeyInputs = journeyInputs;
  document.canonicalIdentity = value.canonicalIdentity;
  document.provenance = value.provenance;
  document.properties = value.properties;
  document.propertyProvenance = value.propertyProvenance;
  return { ok: true, value: Object.freeze(document) };
}

function validateRecordArray(
  value: readonly unknown[],
  path: string,
  issues: ScenarioPersistenceIssue[],
): void {
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      issues.push(
        persistenceIssue(
          path === "journeyInputs" ? "invalid-journey-input" : "invalid-document",
          `${path}[${index}]`,
          `${path}[${index}] must be an object.`,
          "a JSON object",
          typeof entry,
        ),
      );
    }
  }
}

function validateMetadataShape(document: RecordValue, issues: ScenarioPersistenceIssue[]): void {
  const check = (record: RecordValue, path: string): void => {
    for (const key of ["properties", "propertyProvenance"] as const) {
      if (record[key] !== undefined && !isRecord(record[key])) {
        issues.push(
          persistenceIssue(
            "invalid-document",
            `${path}.${key}`,
            `${path}.${key} must be an object when supplied.`,
            "a JSON object",
            typeof record[key],
          ),
        );
      }
    }
  };
  check(document, "$");
  for (const collection of [
    "systems",
    "orbitalAnchors",
    "gates",
    "gateConnections",
    "shipProfiles",
  ] as const) {
    const entries = selectPersistedCollection(document, collection);
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      if (isRecord(entry)) {
        check(entry, `${collection}[${index}]`);
      }
    }
  }
}

function validateRawPropertyConsistency(
  document: RecordValue,
  issues: ScenarioPersistenceIssue[],
): void {
  validatePersistedAliases(document, issues);
  validatePersistedRecordMetadata(document, "", issues);

  const collections = [
    "systems",
    "orbitalAnchors",
    "gates",
    "gateConnections",
    "shipProfiles",
  ] as const;
  for (const collection of collections) {
    const entries = selectPersistedCollection(document, collection);
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      if (isRecord(entry)) {
        validatePersistedRecordMetadata(entry, `${collection}[${index}]`, issues);
      }
    }
  }
}

function validatePersistedAliases(record: RecordValue, issues: ScenarioPersistenceIssue[]): void {
  const aliases = [
    ["orbitalAnchors", "anchors"],
    ["gateConnections", "connections"],
    ["shipProfiles", "profiles"],
    ["references", "sourceReferences"],
    ["references", "citations"],
    ["canonicalClaims", "claims"],
    ["overrides", "overrideLayers"],
    ["journeyInputs", "journeys"],
  ] as const;
  for (const [canonical, legacy] of aliases) {
    const canonicalValue = record[canonical];
    const legacyValue = record[legacy];
    if (canonicalValue === undefined || legacyValue === undefined) {
      continue;
    }
    if (rawJsonEqual(canonicalValue, legacyValue)) {
      continue;
    }
    issues.push(
      persistenceIssue(
        "invalid-document",
        canonical,
        `${canonical} and ${legacy} must agree when both are supplied.`,
        `matching ${canonical} and ${legacy} aliases`,
        "conflicting alias values",
      ),
    );
  }
  validatePersistedJourneyAliases(record, issues);
}

function validatePersistedJourneyAliases(
  record: RecordValue,
  issues: ScenarioPersistenceIssue[],
): void {
  // Keep the explicit helper for the Journey alias because its failure category is part of the
  // public persistence contract, while the common alias audit above covers its equality proof.
  if (
    record.journeyInputs !== undefined &&
    record.savedJourneyInputs !== undefined &&
    !rawJsonEqual(record.journeyInputs, record.savedJourneyInputs)
  ) {
    issues.push(
      persistenceIssue(
        "invalid-journey-input",
        "journeyInputs",
        "journeyInputs and savedJourneyInputs must agree when both are supplied.",
        "matching Journey input aliases",
        "conflicting Journey input aliases",
      ),
    );
  }
}

function selectPersistedAlias(record: RecordValue, canonical: string, legacy: string): unknown {
  return hasOwn(record, canonical) ? record[canonical] : record[legacy];
}

function selectPersistedCollection(
  record: RecordValue,
  canonical: "systems" | "orbitalAnchors" | "gates" | "gateConnections" | "shipProfiles",
): unknown {
  switch (canonical) {
    case "orbitalAnchors":
      return selectPersistedAlias(record, canonical, "anchors");
    case "gateConnections":
      return selectPersistedAlias(record, canonical, "connections");
    case "shipProfiles":
      return selectPersistedAlias(record, canonical, "profiles");
    default:
      return record[canonical];
  }
}

function validateMigrationAliases(
  outer: RecordValue,
  scenario: RecordValue,
  issues: ScenarioPersistenceIssue[],
): void {
  const generator = isRecord(outer.generator) ? outer.generator : undefined;
  const generation = isRecord(outer.generation) ? outer.generation : undefined;
  const scenarioGeneration = isRecord(scenario.generation) ? scenario.generation : undefined;
  validatePersistedGenerationAliases(
    [
      { label: "generatorVersion", value: outer.generatorVersion },
      { label: "generator.version", value: generator?.version },
      { label: "generator.generatorVersion", value: generator?.generatorVersion },
      { label: "generation.generatorVersion", value: generation?.generatorVersion },
      {
        label: "scenario.generation.generatorVersion",
        value: scenarioGeneration?.generatorVersion,
      },
      { label: "scenario.generatorVersion", value: scenario.generatorVersion },
    ],
    "generatorVersion",
    (value) => (typeof value === "string" ? value.trim() : value),
    issues,
  );
  validatePersistedGenerationAliases(
    [
      { label: "seed", value: outer.seed },
      { label: "generator.seed", value: generator?.seed },
      { label: "generation.seed", value: generation?.seed },
      { label: "scenario.generation.seed", value: scenarioGeneration?.seed },
      { label: "scenario.seed", value: scenario.seed },
    ],
    "seed",
    (value) => {
      try {
        return createScenarioSeed(value as ScenarioSeedInput).identity;
      } catch {
        return undefined;
      }
    },
    issues,
  );
  validatePersistedGenerationAliases(
    [
      { label: "logicalPopulation", value: outer.logicalPopulation },
      { label: "population", value: outer.population },
      { label: "generator.logicalPopulation", value: generator?.logicalPopulation },
      { label: "generator.population", value: generator?.population },
      { label: "generation.logicalPopulation", value: generation?.logicalPopulation },
      {
        label: "scenario.generation.logicalPopulation",
        value: scenarioGeneration?.logicalPopulation,
      },
      { label: "scenario.logicalPopulation", value: scenario.logicalPopulation },
      { label: "scenario.population", value: scenario.population },
    ],
    "logicalPopulation",
    (value) => value,
    issues,
  );
  for (const [field, aliases] of [
    [
      "id",
      [
        ["outer.id", outer.id],
        ["scenario.id", scenario.id],
      ],
    ],
    [
      "designation",
      [
        ["outer.designation", outer.designation],
        ["scenario.designation", scenario.designation],
      ],
    ],
    [
      "name",
      [
        ["outer.name", outer.name],
        ["scenario.name", scenario.name],
      ],
    ],
    [
      "epoch",
      [
        ["outer.epoch", outer.epoch],
        ["scenario.epoch", scenario.epoch],
      ],
    ],
  ] as const) {
    validateMigrationAliasGroup(field, aliases, issues);
  }
  for (const [field, aliases] of [
    [
      "properties",
      [
        ["outer.properties", outer.properties],
        ["scenario.properties", scenario.properties],
      ],
    ],
    [
      "propertyProvenance",
      [
        ["outer.propertyProvenance", outer.propertyProvenance],
        ["scenario.propertyProvenance", scenario.propertyProvenance],
      ],
    ],
  ] as const) {
    validateMigrationAliasGroup(field, aliases, issues);
  }
  const arrayGroups = [
    [
      "orbitalAnchors",
      [
        ["outer.orbitalAnchors", outer.orbitalAnchors],
        ["outer.anchors", outer.anchors],
        ["scenario.orbitalAnchors", scenario.orbitalAnchors],
        ["scenario.anchors", scenario.anchors],
      ],
    ],
    [
      "gateConnections",
      [
        ["outer.gateConnections", outer.gateConnections],
        ["outer.connections", outer.connections],
        ["scenario.gateConnections", scenario.gateConnections],
        ["scenario.connections", scenario.connections],
      ],
    ],
    [
      "shipProfiles",
      [
        ["outer.shipProfiles", outer.shipProfiles],
        ["outer.profiles", outer.profiles],
        ["scenario.shipProfiles", scenario.shipProfiles],
        ["scenario.profiles", scenario.profiles],
      ],
    ],
    [
      "references",
      [
        ["outer.references", outer.references],
        ["outer.sourceReferences", outer.sourceReferences],
        ["outer.citations", outer.citations],
        ["scenario.references", scenario.references],
        ["scenario.sourceReferences", scenario.sourceReferences],
        ["scenario.citations", scenario.citations],
      ],
    ],
    [
      "canonicalClaims",
      [
        ["outer.canonicalClaims", outer.canonicalClaims],
        ["outer.claims", outer.claims],
        ["scenario.canonicalClaims", scenario.canonicalClaims],
        ["scenario.claims", scenario.claims],
      ],
    ],
    [
      "overrides",
      [
        ["outer.overrides", outer.overrides],
        ["outer.overrideLayers", outer.overrideLayers],
        ["scenario.overrides", scenario.overrides],
        ["scenario.overrideLayers", scenario.overrideLayers],
      ],
    ],
    [
      "journeyInputs",
      [
        ["outer.journeyInputs", outer.journeyInputs],
        ["outer.savedJourneyInputs", outer.savedJourneyInputs],
        ["outer.journeys", outer.journeys],
        ["scenario.journeyInputs", scenario.journeyInputs],
        ["scenario.savedJourneyInputs", scenario.savedJourneyInputs],
        ["scenario.journeys", scenario.journeys],
      ],
    ],
  ] as const;
  for (const [field, aliases] of arrayGroups) {
    validateMigrationAliasGroup(field, aliases, issues);
  }
}

function validateMigrationAliasGroup(
  field: string,
  aliases: readonly (readonly [string, unknown])[],
  issues: ScenarioPersistenceIssue[],
): void {
  const supplied = aliases.filter(([, value]) => value !== undefined);
  const first = supplied[0];
  if (first === undefined) {
    return;
  }
  for (const alias of supplied.slice(1)) {
    if (rawJsonEqual(first[1], alias[1])) {
      continue;
    }
    issues.push(
      persistenceIssue(
        "migration-failed",
        field,
        `${first[0]} and ${alias[0]} must agree when both are supplied.`,
        `matching ${field} aliases`,
        "conflicting alias values",
      ),
    );
  }
}

function validatePersistedRecordMetadata(
  record: RecordValue,
  path: string,
  issues: ScenarioPersistenceIssue[],
): void {
  const properties = isRecord(record.properties) ? record.properties : undefined;
  const propertyProvenance = isRecord(record.propertyProvenance)
    ? record.propertyProvenance
    : undefined;
  if (properties !== undefined && propertyProvenance !== undefined) {
    if (!rawJsonEqual(properties, propertyProvenance)) {
      issues.push(
        persistenceIssue(
          "invalid-document",
          `${path || "$"}.propertyProvenance`,
          `${path || "$"}.properties and ${path || "$"}.propertyProvenance must be equal when both are supplied.`,
          "equal properties and propertyProvenance records",
          "conflicting metadata records",
        ),
      );
    }
  }

  const metadataProperties = new Set<string>();
  if (properties !== undefined) {
    for (const property of Object.keys(properties)) {
      metadataProperties.add(property);
    }
  }
  if (propertyProvenance !== undefined) {
    for (const property of Object.keys(propertyProvenance)) {
      metadataProperties.add(property);
    }
  }
  for (const property of metadataProperties) {
    const metadataValue =
      properties !== undefined && hasOwn(properties, property)
        ? properties[property]
        : propertyProvenance?.[property];
    if (!isRecord(metadataValue)) {
      continue;
    }
    const metadataPath = `${path || "$"}.properties.${property}`;
    const selectedValue = metadataSelectedValue(metadataValue, metadataPath, issues);
    if (!selectedValue.present || !hasOwn(record, property)) {
      continue;
    }
    const directValue = record[property];
    if (directValue === undefined || rawJsonEqual(selectedValue.value, directValue)) {
      continue;
    }
    issues.push(
      persistenceIssue(
        "invalid-document",
        `${path || "$"}.${property}`,
        `${path || "$"}.${property} disagrees with its property metadata value.`,
        "matching direct field and property metadata values",
        "conflicting values",
      ),
    );
  }
}

function metadataSelectedValue(
  metadata: RecordValue,
  path: string,
  issues: ScenarioPersistenceIssue[],
): { readonly present: boolean; readonly value: unknown } {
  const claim = selectedAlias(metadata, "claim", "canonicalClaim", `${path}.claim`, issues);
  selectedAlias(metadata, "bounds", "uncertainty", `${path}.bounds`, issues);
  const claimValue = claim.present
    ? claimSelectedValue(claim.value, path, issues)
    : { present: false, value: undefined };
  const explicitValues = ["selectedNominal", "nominal", "value"]
    .filter((key) => hasOwn(metadata, key))
    .map((key) => ({ key, value: metadata[key] }));
  validateAliasValues(explicitValues, path, issues);
  if (claimValue.present) {
    validateAliasValues(
      [...explicitValues, { key: "claim.nominal", value: claimValue.value }],
      path,
      issues,
    );
    return claimValue;
  }
  const explicitValue = explicitValues.find(({ value }) => value !== undefined);
  return explicitValue === undefined
    ? { present: false, value: undefined }
    : { present: true, value: explicitValue.value };
}

function claimSelectedValue(
  claim: unknown,
  path: string,
  issues: ScenarioPersistenceIssue[],
): { readonly present: boolean; readonly value: unknown } {
  if (!isRecord(claim)) {
    return { present: false, value: undefined };
  }
  if (claim.kind === "exact") {
    const values = ["value", "nominal", "selectedNominal"]
      .filter((key) => hasOwn(claim, key))
      .map((key) => ({ key: `claim.${key}`, value: claim[key] }));
    validateAliasValues(values, path, issues);
    const selected = values.find(({ key }) => key === "claim.value") ?? values[0];
    return selected === undefined
      ? { present: false, value: undefined }
      : { present: true, value: selected.value };
  }
  if (claim.kind === "range") {
    const values = ["nominal", "selectedNominal"]
      .filter((key) => hasOwn(claim, key))
      .map((key) => ({ key: `claim.${key}`, value: claim[key] }));
    validateAliasValues(values, path, issues);
    const selected = values.find(({ key }) => key === "claim.nominal") ?? values[0];
    if (selected !== undefined) {
      return { present: true, value: selected.value };
    }
    return hasOwn(claim, "lower")
      ? { present: true, value: claim.lower }
      : { present: false, value: undefined };
  }
  return { present: false, value: undefined };
}

function selectedAlias(
  record: RecordValue,
  first: string,
  second: string,
  path: string,
  issues: ScenarioPersistenceIssue[],
): { readonly present: boolean; readonly value: unknown } {
  const values = [first, second]
    .filter((key) => hasOwn(record, key))
    .map((key) => ({ key, value: record[key] }));
  validateAliasValues(values, path, issues);
  const selected = values[0];
  return selected === undefined
    ? { present: false, value: undefined }
    : { present: true, value: selected.value };
}

function validateAliasValues(
  values: readonly { readonly key: string; readonly value: unknown }[],
  path: string,
  issues: ScenarioPersistenceIssue[],
): void {
  const first = values[0];
  if (first === undefined) {
    return;
  }
  for (const value of values.slice(1)) {
    if (rawJsonEqual(first.value, value.value)) {
      continue;
    }
    issues.push(
      persistenceIssue(
        "invalid-document",
        path,
        `${path} aliases ${first.key} and ${value.key} must agree when both are supplied.`,
        "matching alias values",
        "conflicting alias values",
      ),
    );
  }
}

function rawJsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function hasOwn(record: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeReferences(
  value: unknown,
  issues: ScenarioPersistenceIssue[],
): readonly ScenarioReference[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  const references: ScenarioReference[] = [];
  for (const [index, raw] of value.entries()) {
    try {
      references.push(createScenarioReference(raw as ScenarioReferenceInput));
    } catch (error) {
      issues.push(
        persistenceIssue(
          "invalid-reference",
          `references[${index}]`,
          error instanceof Error ? error.message : `references[${index}] is invalid.`,
          "a stable id with at least one citation",
          undefined,
        ),
      );
    }
  }
  return sortReferences(references);
}

function normalizeImportedJourneyInputs(
  value: unknown,
  issues: ScenarioPersistenceIssue[],
): readonly SavedJourneyInput[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  const inputs: SavedJourneyInput[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) {
      issues.push(
        persistenceIssue(
          "invalid-journey-input",
          `journeyInputs[${index}]`,
          `journeyInputs[${index}] must be an object.`,
          "a JSON object",
          typeof raw,
        ),
      );
      continue;
    }
    inputs.push(raw as SavedJourneyInput);
  }
  return Object.freeze(inputs);
}

function sortRawEntities(value: unknown, requireId = true): readonly RecordValue[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  const entries = value.filter(isRecord);
  if (!requireId) {
    return Object.freeze([...entries]);
  }
  return Object.freeze(
    [...entries].sort((left, right) => {
      const leftId = typeof left.id === "string" ? left.id : "";
      const rightId = typeof right.id === "string" ? right.id : "";
      return leftId.localeCompare(rightId);
    }),
  );
}

function normalizeRawAnchors(value: unknown): readonly RecordValue[] {
  const anchors = sortRawEntities(value);
  return Object.freeze(
    anchors.map((anchor) => {
      if (anchor.parentId === undefined) {
        return Object.freeze({ ...anchor, parentId: null });
      }
      return anchor;
    }),
  );
}

function isValidEpoch(value: unknown): value is ScenarioEpoch {
  if (!isRecord(value) || typeof value.label !== "string" || value.label.trim().length === 0) {
    return false;
  }
  return (
    isRecord(value.coordinateTime) &&
    value.coordinateTime.unit === "s" &&
    typeof value.coordinateTime.value === "number" &&
    Number.isFinite(value.coordinateTime.value)
  );
}

function documentToScenarioInput(document: RecordValue): ScenarioInput {
  const anchors = Array.isArray(document.orbitalAnchors)
    ? document.orbitalAnchors.map((anchor) => {
        if (!isRecord(anchor)) {
          return anchor;
        }
        return anchor.parentId === null ? { ...anchor, parentId: undefined } : anchor;
      })
    : [];
  return {
    id: document.id as string,
    designation: document.designation as string,
    name: document.name as string,
    epoch: document.epoch as ScenarioEpoch,
    systems: document.systems as readonly ScenarioInput["systems"][number][],
    orbitalAnchors: anchors as readonly ScenarioInput["orbitalAnchors"][number][],
    gates: document.gates as readonly ScenarioInput["gates"][number][],
    gateConnections:
      document.gateConnections as readonly ScenarioInput["gateConnections"][number][],
    shipProfiles: document.shipProfiles as readonly ScenarioInput["shipProfiles"][number][],
    generatorVersion: document.generatorVersion as string,
    seed: document.seed as ScenarioSeed,
    logicalPopulation: document.logicalPopulation as number,
    generation: {
      generatorVersion: document.generatorVersion as string,
      seed: document.seed as ScenarioSeed,
      logicalPopulation: document.logicalPopulation as number,
    },
    references: document.references as readonly ScenarioReferenceInput[],
    canonicalClaims: document.canonicalClaims as ScenarioInput["canonicalClaims"],
    overrides: document.overrides as ScenarioInput["overrides"],
    journeyInputs: document.journeyInputs as ScenarioInput["journeyInputs"],
    canonicalIdentity: document.canonicalIdentity as ScenarioInput["canonicalIdentity"],
    provenance: document.provenance as ScenarioInput["provenance"],
    properties: document.properties as ScenarioInput["properties"],
    propertyProvenance: document.propertyProvenance as ScenarioInput["propertyProvenance"],
  };
}

function scenarioIssues(issues: readonly ValidationIssue[]): readonly ScenarioPersistenceIssue[] {
  return Object.freeze(
    issues.map((issue) =>
      persistenceIssue(
        persistenceIssueCodeForValidation(issue),
        issue.path,
        issue.message,
        "a valid compiled Scenario",
        issue.code,
      ),
    ),
  );
}

function persistenceIssueCodeForValidation(issue: ValidationIssue): ScenarioPersistenceIssueCode {
  if (issue.code === "invalid-reference" || issue.code === "invalid-citation") {
    return "invalid-reference";
  }
  if (issue.code === "invalid-generation-metadata") {
    return "invalid-generation-metadata";
  }
  if (issue.code === "unsupported-generator-version") {
    return "unsupported-generator-version";
  }
  if (issue.path.startsWith("journeyInputs")) {
    return "invalid-journey-input";
  }
  if (
    issue.code === "invalid-structure" ||
    issue.code === "invalid-claim" ||
    issue.code === "invalid-override" ||
    issue.code === "invalid-provenance" ||
    issue.code === "invalid-precision"
  ) {
    return "invalid-document";
  }
  return "invalid-scenario";
}

function migrationFailure(
  fromSchemaVersion: number | undefined,
  issues: readonly ScenarioPersistenceIssue[],
): ScenarioMigrationFailure {
  return Object.freeze({
    ok: false as const,
    migrated: false as const,
    fromSchemaVersion,
    toSchemaVersion: CURRENT_SCENARIO_SCHEMA_VERSION,
    document: undefined,
    data: undefined,
    serialized: undefined,
    scenario: undefined,
    issues: Object.freeze([...issues]),
  });
}

function persistenceIssue(
  code: ScenarioPersistenceIssueCode,
  path: string,
  message: string,
  expected: string | undefined,
  received: string | undefined,
): ScenarioPersistenceIssue {
  return Object.freeze({ code, path, message, expected, received });
}

function firstDefined(...values: readonly unknown[]): unknown {
  return values.find((value) => value !== undefined);
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
