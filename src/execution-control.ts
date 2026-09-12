export type WorkerPlanningExecutionControl = {
  readonly checkpoint: () => void;
};

const executionControlKey = Symbol("worker-planning-execution-control");

type ControlledValue = {
  readonly [executionControlKey]?: WorkerPlanningExecutionControl;
};

export function attachExecutionControl<Value extends object>(
  value: Value,
  control: WorkerPlanningExecutionControl,
): Value {
  return Object.freeze({
    ...value,
    [executionControlKey]: control,
  }) as Value;
}

export function executionControlFor(value: unknown): WorkerPlanningExecutionControl | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const control = (value as ControlledValue)[executionControlKey];
  return typeof control?.checkpoint === "function" ? control : undefined;
}
