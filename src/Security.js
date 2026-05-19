/* @flow strict */

export type CspDirectives = { +[directive: string]: string | $ReadOnlyArray<string> };

export type HstsOptions = {
  +maxAge: number,
  +includeSubDomains?: boolean,
  +preload?: boolean,
};

export type SecurityHeadersOptions = {
  +csp?: string | CspDirectives,
  +cspReportOnly?: string | CspDirectives,
  +contentTypeOptions?: "nosniff" | "off",
  +frameOptions?: "DENY" | "SAMEORIGIN" | "off" | string,
  +referrerPolicy?: "off" | string,
  +permissionsPolicy?: string,
  +hsts?: HstsOptions | string | "off",
  +crossOriginOpenerPolicy?: "off" | "same-origin" | "same-origin-allow-popups" | "unsafe-none" | string,
  +crossOriginEmbedderPolicy?: "off" | "require-corp" | "unsafe-none" | "credentialless" | string,
  +crossOriginResourcePolicy?: "off" | "same-origin" | "same-site" | "cross-origin" | string,
};

export function buildCspHeader(directives: CspDirectives): string {
  const parts: Array<string> = [];
  for (const directive of Object.keys(directives)) {
    const value: string | $ReadOnlyArray<string> = directives[directive];
    if (typeof value === "string") {
      const trimmed = value.trim();
      parts.push(trimmed === "" ? directive : `${directive} ${trimmed}`);
      continue;
    }
    const items: Array<string> = [];
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim() !== "") {
        items.push(entry.trim());
      }
    }
    parts.push(items.length === 0 ? directive : `${directive} ${items.join(" ")}`);
  }
  return parts.join("; ");
}

function buildHsts(options: HstsOptions): string {
  if (!Number.isFinite(options.maxAge) || options.maxAge < 0) {
    throw new Error("HSTS maxAge must be a non-negative finite number.");
  }
  const parts: Array<string> = [`max-age=${String(Math.floor(options.maxAge))}`];
  if (options.includeSubDomains === true) {
    parts.push("includeSubDomains");
  }
  if (options.preload === true) {
    parts.push("preload");
  }
  return parts.join("; ");
}

function resolveCsp(value: string | CspDirectives): string {
  return typeof value === "string" ? value : buildCspHeader(value);
}

export function securityHeaders(
  options?: SecurityHeadersOptions,
): { +[string]: string } {
  const headers: { [string]: string } = {};

  const cto = options?.contentTypeOptions;
  if (cto !== "off") {
    headers["X-Content-Type-Options"] = cto ?? "nosniff";
  }

  const frame = options?.frameOptions;
  if (frame !== "off") {
    headers["X-Frame-Options"] = frame ?? "DENY";
  }

  const referrer = options?.referrerPolicy;
  if (referrer !== "off") {
    headers["Referrer-Policy"] = referrer ?? "strict-origin-when-cross-origin";
  }

  if (options?.permissionsPolicy != null && options.permissionsPolicy !== "") {
    headers["Permissions-Policy"] = options.permissionsPolicy;
  }

  const hsts = options?.hsts;
  if (hsts != null && hsts !== "off") {
    headers["Strict-Transport-Security"] = typeof hsts === "string" ? hsts : buildHsts(hsts);
  }

  if (options?.csp != null) {
    headers["Content-Security-Policy"] = resolveCsp(options.csp);
  }
  if (options?.cspReportOnly != null) {
    headers["Content-Security-Policy-Report-Only"] = resolveCsp(options.cspReportOnly);
  }

  const coop = options?.crossOriginOpenerPolicy;
  if (coop != null && coop !== "off") {
    headers["Cross-Origin-Opener-Policy"] = coop;
  }
  const coep = options?.crossOriginEmbedderPolicy;
  if (coep != null && coep !== "off") {
    headers["Cross-Origin-Embedder-Policy"] = coep;
  }
  const corp = options?.crossOriginResourcePolicy;
  if (corp != null && corp !== "off") {
    headers["Cross-Origin-Resource-Policy"] = corp;
  }

  return headers;
}
