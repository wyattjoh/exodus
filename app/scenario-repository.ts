import type {
  CompiledScenario,
  JourneyModel,
  ScenarioExportDocument,
  ScenarioExportSource,
  ScenarioMigrationResult,
  ScenarioPersistenceIssue,
  ScenarioPersistenceIssueCode,
  ScenarioImportResult,
  ValidationIssue,
} from "../src/index";

/**
 * One browser-local record stored independently from the immutable bundled catalog.
 */
export type ScenarioStorageRecord = {
  readonly id: string;
  readonly label: string;
  readonly serialized: string;
  readonly updatedAt: number;
  readonly revision: number;
};

/**
 * Injectable transactional storage seam used by the Scenario repository.
 */
export type ScenarioStorageBackend = {
  readonly list: () => Promise<readonly ScenarioStorageRecord[]>;
  readonly get: (id: string) => Promise<ScenarioStorageRecord | undefined>;
  /**
   * Atomically reads, transforms, and stores one record.
   *
   * @param id - Record key that must match the returned record.
   * @param mutation - Synchronous transformation executed inside the backend transaction.
   * @returns The committed record.
   */
  readonly mutate: (
    id: string,
    mutation: (current: ScenarioStorageRecord | undefined) => ScenarioStorageRecord,
  ) => Promise<ScenarioStorageRecord>;
};

/**
 * A parsed browser-local Scenario record returned by repository operations.
 */
export type ScenarioRecord = ScenarioStorageRecord & {
  readonly scenario: CompiledScenario;
  readonly document: ScenarioExportDocument;
};

/**
 * Repository-only structured failure categories.
 */
export type ScenarioRepositoryIssueCode =
  | ScenarioPersistenceIssueCode
  | "not-found"
  | "storage-error";

/**
 * A structured repository failure that never contains a partially imported Scenario.
 */
export type ScenarioRepositoryIssue = Omit<ScenarioPersistenceIssue, "code"> & {
  readonly code: ScenarioRepositoryIssueCode;
};

/**
 * A successful create/open/save/import/migrate/revert result.
 */
export type ScenarioRepositorySuccess = {
  readonly ok: true;
  readonly scenario: CompiledScenario;
  readonly record: ScenarioRecord;
  readonly document: ScenarioExportDocument;
  readonly migrated: boolean;
  readonly migratedFrom: number | undefined;
  readonly issues: readonly [];
};

/**
 * A failed repository operation. No replacement Scenario is exposed on failure.
 */
export type ScenarioRepositoryFailure = {
  readonly ok: false;
  readonly scenario: undefined;
  readonly record: undefined;
  readonly document: undefined;
  readonly migrated: false;
  readonly migratedFrom: number | undefined;
  readonly issues: readonly ScenarioRepositoryIssue[];
};

/**
 * The transactional result returned by a Scenario repository mutation or open operation.
 */
export type ScenarioRepositoryResult = ScenarioRepositorySuccess | ScenarioRepositoryFailure;

/**
 * The result returned when exporting a browser-local Scenario.
 */
export type ScenarioRepositoryExportResult =
  | { readonly ok: true; readonly serialized: string; readonly issues: readonly [] }
  | {
      readonly ok: false;
      readonly serialized: undefined;
      readonly issues: readonly ScenarioRepositoryIssue[];
    };

/**
 * Public local Scenario persistence operations used by the browser application.
 */
export type ScenarioRepository = {
  readonly list: () => Promise<readonly ScenarioStorageRecord[]>;
  readonly create: (
    source: ScenarioExportSource,
    label: string | undefined,
  ) => Promise<ScenarioRepositoryResult>;
  readonly open: (id: string) => Promise<ScenarioRepositoryResult>;
  readonly save: (
    scenario: CompiledScenario,
    label: string | undefined,
  ) => Promise<ScenarioRepositoryResult>;
  readonly export: (id: string) => Promise<ScenarioRepositoryExportResult>;
  readonly import: (input: unknown, label: string | undefined) => Promise<ScenarioRepositoryResult>;
  readonly migrate: (
    input: unknown,
    label: string | undefined,
  ) => Promise<ScenarioRepositoryResult>;
  readonly revert: (id: string, layerId: string) => Promise<ScenarioRepositoryResult>;
};

/**
 * Options for constructing a repository with deterministic application dependencies.
 */
export type ScenarioRepositoryOptions = {
  readonly model: JourneyModel;
  readonly backend: ScenarioStorageBackend;
  readonly clock?: (() => number) | undefined;
};

function issue(
  code: ScenarioRepositoryIssueCode,
  path: string,
  message: string,
): ScenarioRepositoryIssue {
  return Object.freeze({
    code,
    path,
    message,
    expected: undefined,
    received: undefined,
  });
}

function failure(
  issues: readonly ScenarioRepositoryIssue[],
  migratedFrom: number | undefined = undefined,
): ScenarioRepositoryFailure {
  return Object.freeze({
    ok: false as const,
    scenario: undefined,
    record: undefined,
    document: undefined,
    migrated: false as const,
    migratedFrom,
    issues: Object.freeze([...issues]),
  });
}

function fromPersistenceIssues(
  issues: readonly ScenarioPersistenceIssue[],
): readonly ScenarioRepositoryIssue[] {
  return Object.freeze(issues.map((value) => Object.freeze({ ...value })));
}

function fromValidationIssues(
  issues: readonly ValidationIssue[],
): readonly ScenarioRepositoryIssue[] {
  return Object.freeze(
    issues.map((value) =>
      Object.freeze({
        code: "invalid-scenario" as const,
        path: value.path,
        message: value.message,
        expected: undefined,
        received: undefined,
      }),
    ),
  );
}

function labelFor(scenario: CompiledScenario, label: string | undefined): string {
  const normalized = label?.trim();
  return normalized === undefined || normalized.length === 0 ? scenario.name : normalized;
}

function safeRevision(record: ScenarioStorageRecord | undefined): number {
  return record === undefined || !Number.isSafeInteger(record.revision) || record.revision < 0
    ? 0
    : record.revision;
}

async function persistScenario(
  model: JourneyModel,
  backend: ScenarioStorageBackend,
  clock: () => number,
  scenario: CompiledScenario,
  label: string | undefined,
  migrated: boolean,
  migratedFrom: number | undefined,
): Promise<ScenarioRepositoryResult> {
  try {
    const document = model.createScenarioExport(scenario);
    const serialized = model.exportScenario(scenario);
    const stored = await backend.mutate(scenario.id, (previous) =>
      Object.freeze({
        id: scenario.id,
        label: labelFor(scenario, label),
        serialized,
        updatedAt: clock(),
        revision: safeRevision(previous) + 1,
      }),
    );
    const record: ScenarioRecord = Object.freeze({
      ...stored,
      scenario,
      document,
    });
    return Object.freeze({
      ok: true as const,
      scenario,
      record,
      document,
      migrated,
      migratedFrom,
      issues: Object.freeze([]) as readonly [],
    });
  } catch (error) {
    return failure([
      issue(
        "storage-error",
        "$",
        error instanceof Error ? error.message : "Scenario could not be persisted.",
      ),
    ]);
  }
}

async function persistImported(
  model: JourneyModel,
  backend: ScenarioStorageBackend,
  clock: () => number,
  result: ScenarioImportResult | ScenarioMigrationResult,
  label: string | undefined,
): Promise<ScenarioRepositoryResult> {
  if (!result.ok) {
    const fromSchemaVersion =
      "fromSchemaVersion" in result ? result.fromSchemaVersion : result.migratedFrom;
    return failure(fromPersistenceIssues(result.issues), fromSchemaVersion);
  }
  const fromSchemaVersion =
    "fromSchemaVersion" in result ? result.fromSchemaVersion : result.migratedFrom;
  const toSchemaVersion = "toSchemaVersion" in result ? result.toSchemaVersion : undefined;
  return persistScenario(
    model,
    backend,
    clock,
    result.scenario,
    label,
    result.migrated,
    result.migrated &&
      fromSchemaVersion !== undefined &&
      (toSchemaVersion === undefined || fromSchemaVersion !== toSchemaVersion)
      ? fromSchemaVersion
      : undefined,
  );
}

/**
 * Creates a local repository over an injectable storage backend.
 *
 * @param options - Model, storage, and clock dependencies.
 * @returns Transactional browser-local Scenario operations.
 */
export function createScenarioRepository(options: ScenarioRepositoryOptions): ScenarioRepository {
  const clock = options.clock ?? (() => Date.now());
  return Object.freeze({
    async list() {
      const records = await options.backend.list();
      return Object.freeze([...records].sort((left, right) => left.id.localeCompare(right.id)));
    },
    async create(source: ScenarioExportSource, label: string | undefined) {
      try {
        const compiled = options.model.compileScenario(source);
        if (!compiled.ok) {
          return failure(fromValidationIssues(compiled.issues));
        }
        const serialized = options.model.exportScenario(compiled.scenario);
        const imported = options.model.importScenario(serialized);
        return persistImported(options.model, options.backend, clock, imported, label);
      } catch (error) {
        return failure([
          issue(
            "invalid-scenario",
            "$",
            error instanceof Error ? error.message : "Scenario could not be created.",
          ),
        ]);
      }
    },
    async open(id: string) {
      const stored = await options.backend.get(id);
      if (stored === undefined) {
        return failure([issue("not-found", "id", `Scenario ${JSON.stringify(id)} was not found.`)]);
      }
      const imported = options.model.importScenario(stored.serialized);
      if (!imported.ok) {
        return failure(fromPersistenceIssues(imported.issues), imported.migratedFrom);
      }
      if (imported.migrated) {
        return persistImported(options.model, options.backend, clock, imported, stored.label);
      }
      const record: ScenarioRecord = Object.freeze({
        ...stored,
        scenario: imported.scenario,
        document: imported.document,
      });
      return Object.freeze({
        ok: true as const,
        scenario: imported.scenario,
        record,
        document: imported.document,
        migrated: false as const,
        migratedFrom: undefined,
        issues: Object.freeze([]) as readonly [],
      });
    },
    async save(scenario: CompiledScenario, label: string | undefined) {
      return persistScenario(
        options.model,
        options.backend,
        clock,
        scenario,
        label,
        false,
        undefined,
      );
    },
    async export(id: string) {
      const stored = await options.backend.get(id);
      if (stored === undefined) {
        return Object.freeze({
          ok: false as const,
          serialized: undefined,
          issues: Object.freeze([
            issue("not-found", "id", `Scenario ${JSON.stringify(id)} was not found.`),
          ]),
        });
      }
      const imported = options.model.importScenario(stored.serialized);
      if (!imported.ok) {
        return Object.freeze({
          ok: false as const,
          serialized: undefined,
          issues: fromPersistenceIssues(imported.issues),
        });
      }
      return Object.freeze({
        ok: true as const,
        serialized: imported.serialized,
        issues: Object.freeze([]) as readonly [],
      });
    },
    async import(input: unknown, label: string | undefined) {
      return persistImported(
        options.model,
        options.backend,
        clock,
        options.model.importScenario(input),
        label,
      );
    },
    async migrate(input: unknown, label: string | undefined) {
      return persistImported(
        options.model,
        options.backend,
        clock,
        options.model.migrateScenario(input),
        label,
      );
    },
    async revert(id: string, layerId: string) {
      const opened = await this.open(id);
      if (!opened.ok) {
        return opened;
      }
      try {
        const reverted = options.model.revertScenarioOverride(opened.scenario, layerId);
        return persistScenario(
          options.model,
          options.backend,
          clock,
          reverted,
          opened.record.label,
          false,
          undefined,
        );
      } catch (error) {
        return failure([
          issue(
            "invalid-scenario",
            `overrides.${layerId}`,
            error instanceof Error ? error.message : "Scenario override could not be reverted.",
          ),
        ]);
      }
    },
  });
}

/**
 * Creates an in-memory transactional backend for deterministic tests and non-browser previews.
 *
 * @param initial - Optional records to seed the backend with.
 * @returns A storage seam with the same behavior as the IndexedDB backend.
 */
export function createMemoryScenarioBackend(
  initial: readonly ScenarioStorageRecord[] = [],
): ScenarioStorageBackend {
  const records = new Map(initial.map((record) => [record.id, Object.freeze({ ...record })]));
  return Object.freeze({
    async list() {
      return Object.freeze([...records.values()].map((record) => Object.freeze({ ...record })));
    },
    async get(id: string) {
      const record = records.get(id);
      return record === undefined ? undefined : Object.freeze({ ...record });
    },
    async mutate(id: string, mutation) {
      const current = records.get(id);
      const next = mutation(current === undefined ? undefined : Object.freeze({ ...current }));
      if (next.id !== id) {
        throw new Error(`Scenario storage mutation changed record id from ${id} to ${next.id}.`);
      }
      const stored = Object.freeze({ ...next });
      records.set(id, stored);
      return Object.freeze({ ...stored });
    },
  });
}

/**
 * The IndexedDB schema version for browser-local Scenario records.
 */
export const SCENARIO_DATABASE_VERSION = 1;

/**
 * Options for the IndexedDB backend.
 */
export type IndexedDbScenarioBackendOptions = {
  readonly indexedDB?: IDBFactory | undefined;
  readonly databaseName?: string | undefined;
  readonly storeName?: string | undefined;
};

function browserIndexedDb(factory: IDBFactory | undefined): IDBFactory {
  if (factory !== undefined) {
    return factory;
  }
  const candidate = (globalThis as typeof globalThis & { readonly indexedDB?: IDBFactory })
    .indexedDB;
  if (candidate === undefined) {
    throw new Error("IndexedDB is unavailable; inject a ScenarioStorageBackend for this runtime.");
  }
  return candidate;
}

function openDatabase(
  factory: IDBFactory,
  databaseName: string,
  storeName: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, SCENARIO_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        const store = database.createObjectStore(storeName, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
    request.onblocked = () =>
      reject(new Error("IndexedDB upgrade is blocked by another connection."));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionError(transaction: IDBTransaction): Error {
  return transaction.error ?? new Error("IndexedDB transaction failed.");
}

/**
 * Creates the production IndexedDB backend.
 *
 * Each write uses one read/write transaction and records the canonical Scenario JSON as an opaque
 * value. Domain validation and schema migration happen before the write in the repository seam.
 *
 * @param options - Optional injected IDB factory and database names.
 * @returns An IndexedDB-backed transactional storage seam.
 */
export function createIndexedDbScenarioBackend(
  options: IndexedDbScenarioBackendOptions = {},
): ScenarioStorageBackend {
  const databaseName = options.databaseName ?? "centauri-journey-calculator";
  const storeName = options.storeName ?? "scenarios";
  const factory = browserIndexedDb(options.indexedDB);
  let databasePromise: Promise<IDBDatabase> | undefined;
  const database = (): Promise<IDBDatabase> => {
    databasePromise ??= openDatabase(factory, databaseName, storeName);
    return databasePromise;
  };

  return Object.freeze({
    async list() {
      const db = await database();
      return new Promise<readonly ScenarioStorageRecord[]>((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        let records: readonly ScenarioStorageRecord[] = [];
        request.onsuccess = () => {
          records = Object.freeze(
            (request.result as ScenarioStorageRecord[]).map((record) =>
              Object.freeze({ ...record }),
            ),
          );
        };
        request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed."));
        transaction.oncomplete = () => resolve(records);
        transaction.onerror = () => reject(transactionError(transaction));
        transaction.onabort = () => reject(transactionError(transaction));
      });
    },
    async get(id: string) {
      const db = await database();
      return new Promise<ScenarioStorageRecord | undefined>((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).get(id);
        let record: ScenarioStorageRecord | undefined;
        request.onsuccess = () => {
          record = request.result === undefined ? undefined : Object.freeze({ ...request.result });
        };
        request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed."));
        transaction.oncomplete = () => resolve(record);
        transaction.onerror = () => reject(transactionError(transaction));
        transaction.onabort = () => reject(transactionError(transaction));
      });
    },
    async mutate(id: string, mutation) {
      const db = await database();
      return new Promise<ScenarioStorageRecord>((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        let committed: ScenarioStorageRecord | undefined;
        let mutationFailure: Error | undefined;
        let settled = false;
        const rejectOnce = (error: Error): void => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        };
        const abortWith = (error: unknown): void => {
          mutationFailure =
            error instanceof Error ? error : new Error("IndexedDB mutation failed.");
          try {
            transaction.abort();
          } catch {
            rejectOnce(mutationFailure);
          }
        };
        const request = store.get(id);
        request.onsuccess = () => {
          try {
            const current =
              request.result === undefined
                ? undefined
                : Object.freeze({ ...(request.result as ScenarioStorageRecord) });
            const next = mutation(current);
            if (next.id !== id) {
              throw new Error(
                `Scenario storage mutation changed record id from ${id} to ${next.id}.`,
              );
            }
            store.put({ ...next });
            committed = Object.freeze({ ...next });
          } catch (error) {
            abortWith(error);
          }
        };
        request.onerror = () => abortWith(request.error ?? new Error("IndexedDB read failed."));
        transaction.oncomplete = () => {
          if (committed === undefined) {
            rejectOnce(mutationFailure ?? new Error("IndexedDB mutation did not commit."));
            return;
          }
          settled = true;
          resolve(committed);
        };
        transaction.onerror = () => rejectOnce(mutationFailure ?? transactionError(transaction));
        transaction.onabort = () => rejectOnce(mutationFailure ?? transactionError(transaction));
      });
    },
  });
}
