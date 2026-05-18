/* @flow strict */

export class AbortError extends Error {
  reason: mixed;

  constructor(reason?: mixed): void {
    const message = typeof reason === "string"
      ? reason
      : reason != null && typeof (reason as $FlowFixMe).message === "string"
        ? (reason as $FlowFixMe).message
        : "Dispatch was aborted.";
    super(message);
    this.name = "AbortError";
    this.reason = reason;
  }
}

export function isAbortError(value: mixed): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    (value as $FlowFixMe).name === "AbortError"
  );
}

export function resolveSignal(
  optionsSignal: ?AbortSignal,
  requestSignal: ?AbortSignal,
): ?AbortSignal {
  if (optionsSignal != null) {
    return optionsSignal;
  }
  if (requestSignal != null) {
    return requestSignal;
  }
  return null;
}

export function checkAborted(signal: ?AbortSignal): void {
  if (signal != null && signal.aborted) {
    const reason: mixed = (signal as $FlowFixMe).reason;
    throw new AbortError(reason);
  }
}

export function abortToError(signal: AbortSignal): AbortError {
  const reason: mixed = (signal as $FlowFixMe).reason;
  return new AbortError(reason);
}
