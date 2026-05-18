/* @flow strict */

import type {
  BadRequestSignal,
  ForbiddenSignal,
  HttpMethod,
  MethodNotAllowedSignal,
  NotFoundSignal,
  RedirectSignal,
  RouteSignal,
} from "./Types";

const SIGNAL_TAG = Symbol.for("flow-membrane.signal");

class MembraneSignalError extends Error {
  signal: RouteSignal;
  // $FlowFixMe[unsupported-syntax] - we tag the error so consumers can recognize it.
  +[SIGNAL_TAG]: true;

  constructor(signal: RouteSignal): void {
    super(signal.kind === "redirect"
      ? `redirect:${signal.to}`
      : signal.message ?? signal.kind);
    this.name = "MembraneSignalError";
    this.signal = signal;
    Object.defineProperty(this, SIGNAL_TAG, { value: true, enumerable: false });
  }
}

export function isSignalError(value: mixed): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    (value as $FlowFixMe)[SIGNAL_TAG] === true
  );
}

export function signalOf(value: mixed): ?RouteSignal {
  if (!isSignalError(value)) {
    return null;
  }
  return (value as $FlowFixMe).signal as RouteSignal;
}

export function redirect(
  to: string,
  params?: {
    +status?: 301 | 302 | 303 | 307 | 308,
    +headers?: { +[string]: string },
    +setCookies?: $ReadOnlyArray<string>,
  },
): empty {
  const signal: RedirectSignal = {
    kind: "redirect",
    to,
    status: params?.status ?? 307,
    headers: params?.headers,
    setCookies: params?.setCookies,
  };
  throw new MembraneSignalError(signal);
}

export function notFound(message?: string): empty {
  const signal: NotFoundSignal = {
    kind: "notFound",
    message,
  };
  throw new MembraneSignalError(signal);
}

export function forbidden(message?: string): empty {
  const signal: ForbiddenSignal = {
    kind: "forbidden",
    message,
  };
  throw new MembraneSignalError(signal);
}

export function badRequest(message?: string, cause?: mixed): empty {
  const signal: BadRequestSignal = {
    kind: "badRequest",
    message,
    cause,
  };
  throw new MembraneSignalError(signal);
}

export function methodNotAllowed(
  method: HttpMethod,
  allowed: $ReadOnlyArray<HttpMethod>,
  message?: string,
): empty {
  const signal: MethodNotAllowedSignal = {
    kind: "methodNotAllowed",
    method,
    allowed,
    message,
  };
  throw new MembraneSignalError(signal);
}

export function makeRedirect(
  to: string,
  params?: {
    +status?: 301 | 302 | 303 | 307 | 308,
    +headers?: { +[string]: string },
    +setCookies?: $ReadOnlyArray<string>,
  },
): RedirectSignal {
  return {
    kind: "redirect",
    to,
    status: params?.status ?? 307,
    headers: params?.headers,
    setCookies: params?.setCookies,
  };
}

export function makeNotFound(message?: string): NotFoundSignal {
  return { kind: "notFound", message };
}

export function makeForbidden(message?: string): ForbiddenSignal {
  return { kind: "forbidden", message };
}

export function makeBadRequest(message?: string, cause?: mixed): BadRequestSignal {
  return { kind: "badRequest", message, cause };
}

export function makeMethodNotAllowed(
  method: HttpMethod,
  allowed: $ReadOnlyArray<HttpMethod>,
  message?: string,
): MethodNotAllowedSignal {
  return { kind: "methodNotAllowed", method, allowed, message };
}

export function isRedirect(value: mixed): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    (value as $FlowFixMe).kind === "redirect" &&
    typeof (value as $FlowFixMe).to === "string"
  );
}

export function isNotFound(value: mixed): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    (value as $FlowFixMe).kind === "notFound"
  );
}

export function isForbidden(value: mixed): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    (value as $FlowFixMe).kind === "forbidden"
  );
}

export function isBadRequest(value: mixed): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    (value as $FlowFixMe).kind === "badRequest"
  );
}

export function isMethodNotAllowed(value: mixed): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    (value as $FlowFixMe).kind === "methodNotAllowed"
  );
}

export function isSignal(value: mixed): boolean {
  return (
    isRedirect(value) ||
    isNotFound(value) ||
    isForbidden(value) ||
    isBadRequest(value) ||
    isMethodNotAllowed(value)
  );
}
