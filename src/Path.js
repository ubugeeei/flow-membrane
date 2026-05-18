/* @flow strict */

import type {
  AnyParams,
  AnyQuery,
  CompiledPath,
  CompiledSegment,
  ParamCodec,
  ParamCodecs,
} from "./Types";

const stringCodec: ParamCodec<string> = {
  name: "string",
  parse: (raw: string): string => raw,
  serialize: (value: string): string => String(value),
};

const intCodec: ParamCodec<number> = {
  name: "int",
  parse: (raw: string): number => {
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`Invalid integer param: ${raw}`);
    }
    return n;
  },
  serialize: (value: number): string => String(value),
};

const uuidCodec: ParamCodec<string> = {
  name: "uuid",
  parse: (raw: string): string => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      throw new Error(`Invalid uuid param: ${raw}`);
    }
    return raw;
  },
  serialize: (value: string): string => value,
};

export const codecs = {
  string: (): ParamCodec<string> => stringCodec,
  int: (): ParamCodec<number> => intCodec,
  uuid: (): ParamCodec<string> => uuidCodec,
  id: <T>(): ParamCodec<T> => (stringCodec as $FlowFixMe as ParamCodec<T>),
};

export function joinPath(prefix: string, segment: string): string {
  if (prefix === "" || prefix === "/") {
    return segment.startsWith("/") ? segment : `/${segment}`;
  }
  const head = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  if (segment === "" || segment === "/") {
    return head === "" ? "/" : head;
  }
  const tail = segment.startsWith("/") ? segment.slice(1) : segment;
  return `${head}/${tail}`;
}

export function compilePath(pattern: string): CompiledPath {
  if (typeof pattern !== "string") {
    throw new TypeError("Route pattern must be a string.");
  }

  const normalized = pattern.startsWith("/") ? pattern : `/${pattern}`;
  const rawSegments = normalized === "/" ? [] : normalized.slice(1).split("/");
  const segments: Array<CompiledSegment> = [];
  const paramNames: Array<string> = [];

  for (const raw of rawSegments) {
    if (raw === "") {
      continue;
    }

    if (raw.startsWith(":")) {
      const name = raw.slice(1);
      if (name === "") {
        throw new Error(`Empty parameter name in pattern: ${pattern}`);
      }
      segments.push({ kind: "param", name, codec: null });
      paramNames.push(name);
      continue;
    }

    if (raw.startsWith("*")) {
      const name = raw.slice(1) === "" ? "rest" : raw.slice(1);
      segments.push({ kind: "catchAll", name });
      paramNames.push(name);
      continue;
    }

    segments.push({ kind: "literal", value: raw });
  }

  return {
    pattern: normalized,
    segments,
    paramNames,
  };
}

export function attachCodecs(
  path: CompiledPath,
  codecMap: ?ParamCodecs,
): CompiledPath {
  if (codecMap == null) {
    return path;
  }
  const segments: Array<CompiledSegment> = path.segments.map(segment => {
    if (segment.kind !== "param") {
      return segment;
    }
    const codec = codecMap[segment.name];
    if (codec == null) {
      return segment;
    }
    const replaced: CompiledSegment = { kind: "param", name: segment.name, codec };
    return replaced;
  });
  return {
    pattern: path.pattern,
    segments,
    paramNames: path.paramNames,
  };
}

export function combinePaths(parent: CompiledPath, child: CompiledPath): CompiledPath {
  const segments: Array<CompiledSegment> = parent.segments.concat(child.segments);
  const paramNames = parent.paramNames.concat(child.paramNames);
  const pattern = joinPath(parent.pattern, child.pattern);
  return { pattern, segments, paramNames };
}

export type MatchAttempt = {
  +params: { [string]: mixed },
  +remaining: $ReadOnlyArray<string>,
  +consumed: $ReadOnlyArray<string>,
};

function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch (_err) {
    return raw;
  }
}

export function matchPathSegments(
  path: CompiledPath,
  segments: $ReadOnlyArray<string>,
): ?MatchAttempt {
  const params: { [string]: mixed } = {};
  let cursor = 0;

  for (let index = 0; index < path.segments.length; index += 1) {
    const segment = path.segments[index];

    if (segment.kind === "catchAll") {
      const rest = segments.slice(cursor).map(decodeSegment);
      params[segment.name] = rest;
      return {
        params,
        consumed: segments.slice(0, segments.length),
        remaining: [],
      };
    }

    if (cursor >= segments.length) {
      return null;
    }

    const raw = segments[cursor];

    if (segment.kind === "literal") {
      if (decodeSegment(raw) !== segment.value) {
        return null;
      }
      cursor += 1;
      continue;
    }

    if (segment.kind === "param") {
      const value = decodeSegment(raw);
      if (segment.codec != null) {
        try {
          params[segment.name] = segment.codec.parse(value);
        } catch (_err) {
          return null;
        }
      } else {
        params[segment.name] = value;
      }
      cursor += 1;
      continue;
    }
  }

  return {
    params,
    consumed: segments.slice(0, cursor),
    remaining: segments.slice(cursor),
  };
}

export function urlSegments(url: URL): Array<string> {
  const pathname = url.pathname;
  if (pathname === "/" || pathname === "") {
    return [];
  }
  return pathname
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .split("/")
    .filter(part => part !== "");
}

export function parseQuery(url: URL): AnyQuery {
  const result: { [string]: string | Array<string> } = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (Object.hasOwn(result, key)) {
      const current = result[key];
      result[key] = Array.isArray(current) ? current.concat(value) : [current, value];
    } else {
      result[key] = value;
    }
  }
  return result as $FlowFixMe as AnyQuery;
}

export function buildPath(
  path: CompiledPath,
  params: AnyParams,
): string {
  const parts: Array<string> = [];
  for (const segment of path.segments) {
    if (segment.kind === "literal") {
      parts.push(segment.value);
      continue;
    }
    if (segment.kind === "param") {
      const value = params[segment.name];
      if (value == null) {
        throw new Error(`Missing param "${segment.name}" for path ${path.pattern}`);
      }
      const serialized = segment.codec != null
        ? segment.codec.serialize(value)
        : String(value);
      parts.push(encodeURIComponent(serialized));
      continue;
    }
    if (segment.kind === "catchAll") {
      const value = params[segment.name];
      if (Array.isArray(value)) {
        for (const part of value) {
          parts.push(encodeURIComponent(String(part)));
        }
      } else if (value != null) {
        parts.push(encodeURIComponent(String(value)));
      }
      continue;
    }
  }
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export function buildHref(
  path: CompiledPath,
  params: AnyParams,
  query?: AnyQuery,
  hash?: string,
): string {
  const pathname = buildPath(path, params);
  const search = serializeQuery(query);
  const fragment = hash != null && hash !== "" ? `#${hash.replace(/^#/, "")}` : "";
  return `${pathname}${search}${fragment}`;
}

export function serializeQuery(query: ?AnyQuery): string {
  if (query == null) {
    return "";
  }
  const params = new URLSearchParams();
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, entry);
      }
    } else if (typeof value === "string") {
      params.append(key, value);
    }
  }
  const serialized = params.toString();
  return serialized === "" ? "" : `?${serialized}`;
}
