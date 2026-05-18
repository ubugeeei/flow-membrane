/* @flow strict */

export type SameSite = "Strict" | "Lax" | "None";

export type CookieOptions = {
  +domain?: string,
  +path?: string,
  +maxAge?: number,
  +expires?: Date | string,
  +httpOnly?: boolean,
  +secure?: boolean,
  +sameSite?: SameSite,
  +priority?: "Low" | "Medium" | "High",
  +partitioned?: boolean,
};

const COOKIE_NAME_BAD = /[\s,;=]/;
const COOKIE_VALUE_BAD = /[\s,;]/;

export function serializeCookie(
  name: string,
  value: string,
  options?: CookieOptions,
): string {
  if (typeof name !== "string" || name === "") {
    throw new TypeError("Cookie name must be a non-empty string.");
  }
  if (COOKIE_NAME_BAD.test(name)) {
    throw new TypeError(`Invalid cookie name: ${name}`);
  }
  if (typeof value !== "string") {
    throw new TypeError("Cookie value must be a string.");
  }
  const encodedValue = COOKIE_VALUE_BAD.test(value)
    ? encodeURIComponent(value)
    : value;

  const parts: Array<string> = [`${name}=${encodedValue}`];
  if (options?.domain != null) {
    parts.push(`Domain=${options.domain}`);
  }
  parts.push(`Path=${options?.path ?? "/"}`);
  if (options?.maxAge != null) {
    if (!Number.isFinite(options.maxAge)) {
      throw new TypeError("Cookie maxAge must be a finite number.");
    }
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }
  if (options?.expires != null) {
    const expires = options.expires instanceof Date
      ? options.expires.toUTCString()
      : options.expires;
    parts.push(`Expires=${expires}`);
  }
  if (options?.httpOnly === true) {
    parts.push("HttpOnly");
  }
  const secure = options?.secure ?? (options?.sameSite === "None");
  if (secure === true) {
    parts.push("Secure");
  }
  if (options?.sameSite != null) {
    parts.push(`SameSite=${options.sameSite}`);
  } else {
    parts.push("SameSite=Lax");
  }
  if (options?.priority != null) {
    parts.push(`Priority=${options.priority}`);
  }
  if (options?.partitioned === true) {
    parts.push("Partitioned");
  }
  return parts.join("; ");
}

export function clearCookie(
  name: string,
  options?: CookieOptions,
): string {
  return serializeCookie(name, "", {
    ...(options ?? {}),
    maxAge: 0,
    expires: new Date(0),
  });
}

export function parseCookieHeader(header: ?string): { +[string]: string } {
  if (header == null || header === "") {
    const empty: { +[string]: string } = {};
    return empty;
  }
  const out: { [string]: string } = {};
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed === "") {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      out[trimmed] = "";
    } else {
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1);
      try {
        out[key] = decodeURIComponent(value);
      } catch (_err) {
        out[key] = value;
      }
    }
  }
  return out;
}
