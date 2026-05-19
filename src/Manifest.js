/* @flow strict */

import {
  attachCodecs,
  combinePaths,
  compilePath,
  joinPath,
} from "./Path";
import type {
  AnyParams,
  App,
  AppOptions,
  CompiledPath,
  GroupOptions,
  Guard,
  GuardFn,
  Middleware,
  MiddlewareFn,
  ParamCodecs,
  QueryCodecs,
  RouteMatch,
  RouteNode,
  RouteOptions,
} from "./Types";
import { matchRoute } from "./Match";

let nextId = 0;

function generateId(prefix: string): string {
  nextId += 1;
  return `${prefix}:${String(nextId)}`;
}

export function middleware(fn: MiddlewareFn, id?: string): Middleware {
  return {
    kind: "middleware",
    id: id ?? generateId("middleware"),
    run: fn,
  };
}

export function guard<Params: AnyParams = AnyParams>(
  fn: GuardFn<Params>,
  id?: string,
): Guard<Params> {
  return {
    kind: "guard",
    id: id ?? generateId("guard"),
    run: fn,
  };
}

function normalizeMiddleware(
  list?: $ReadOnlyArray<Middleware | MiddlewareFn>,
): Array<Middleware> {
  if (list == null) {
    return [];
  }
  return list.map(entry => {
    if (typeof entry === "function") {
      return middleware(entry);
    }
    if (entry != null && entry.kind === "middleware") {
      return entry;
    }
    throw new TypeError("Invalid middleware entry.");
  });
}

function normalizeGuard<Params: AnyParams>(
  entry: ?(Guard<Params> | GuardFn<Params>),
): ?Guard<Params> {
  if (entry == null) {
    return null;
  }
  if (typeof entry === "function") {
    return guard<Params>(entry);
  }
  if (entry != null && entry.kind === "guard") {
    return entry;
  }
  throw new TypeError("Invalid guard entry.");
}

export type RoutePathArg = string;

export function route<Params: AnyParams = AnyParams>(
  path: RoutePathArg,
  options: RouteOptions<Params>,
): RouteNode {
  const compiled: CompiledPath = attachCodecs(compilePath(path), options.params ?? null);
  const guards: Array<Guard<AnyParams>> = [];
  const guardEntry = normalizeGuard<AnyParams>(
    options.guard as $FlowFixMe as ?(Guard<AnyParams> | GuardFn<AnyParams>),
  );
  if (guardEntry != null) {
    guards.push(guardEntry);
  }
  return {
    kind: "route",
    id: options.id ?? generateId("route"),
    path: compiled,
    module: options.module as $FlowFixMe,
    guards,
    middleware: normalizeMiddleware(options.middleware),
    paramCodecs: options.params ?? ({} as ParamCodecs),
    queryCodecs: options.query ?? ({} as QueryCodecs),
    methods: options.methods ?? null,
  };
}

export function group<Params: AnyParams = AnyParams>(
  path: RoutePathArg,
  options: GroupOptions<Params>,
): RouteNode {
  const compiled: CompiledPath = attachCodecs(compilePath(path), options.params ?? null);
  const guards: Array<Guard<AnyParams>> = [];
  const guardEntry = normalizeGuard<AnyParams>(
    options.guard as $FlowFixMe as ?(Guard<AnyParams> | GuardFn<AnyParams>),
  );
  if (guardEntry != null) {
    guards.push(guardEntry);
  }
  return {
    kind: "group",
    id: options.id ?? generateId("group"),
    path: compiled,
    layout: options.layout,
    guards,
    middleware: normalizeMiddleware(options.middleware),
    paramCodecs: options.params ?? ({} as ParamCodecs),
    queryCodecs: options.query ?? ({} as QueryCodecs),
    methods: options.methods ?? null,
    routes: options.routes,
  };
}

function flattenPaths(
  node: RouteNode,
  parentPath: CompiledPath,
  acc: Array<string>,
): void {
  const combined = combinePaths(parentPath, node.path);
  if (node.kind === "route") {
    acc.push(combined.pattern);
    return;
  }
  for (const child of node.routes) {
    flattenPaths(child, combined, acc);
  }
}

function findById(nodes: $ReadOnlyArray<RouteNode>, id: string): ?RouteNode {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (node.kind === "group") {
      const inner = findById(node.routes, id);
      if (inner != null) {
        return inner;
      }
    }
  }
  return null;
}

function structuralPattern(path: CompiledPath): string {
  const parts: Array<string> = [];
  for (const segment of path.segments) {
    if (segment.kind === "literal") {
      parts.push(`L:${segment.value}`);
    } else if (segment.kind === "param") {
      parts.push("P");
    } else if (segment.kind === "catchAll") {
      parts.push("C");
    }
  }
  return parts.join("/");
}

type ValidationState = {
  +ids: Set<string>,
  +structures: Set<string>,
  +issues: Array<string>,
};

function walkValidate(
  nodes: $ReadOnlyArray<RouteNode>,
  parentPattern: string,
  parentStructure: string,
  state: ValidationState,
): void {
  for (const node of nodes) {
    if (state.ids.has(node.id)) {
      state.issues.push(`Duplicate route id: "${node.id}"`);
    } else {
      state.ids.add(node.id);
    }

    let sawCatchAll = false;
    for (const segment of node.path.segments) {
      if (sawCatchAll) {
        state.issues.push(
          `Catch-all segment must be the last segment in pattern "${node.path.pattern}" (route id "${node.id}")`,
        );
        break;
      }
      if (segment.kind === "catchAll") {
        sawCatchAll = true;
      }
    }

    const combinedPattern = joinPath(parentPattern, node.path.pattern);
    const localStructure = structuralPattern(node.path);
    const fullStructure = parentStructure === ""
      ? localStructure
      : (localStructure === "" ? parentStructure : `${parentStructure}/${localStructure}`);

    if (node.kind === "route") {
      if (state.structures.has(fullStructure)) {
        state.issues.push(
          `Duplicate route pattern: "${combinedPattern}" (route id "${node.id}")`,
        );
      } else {
        state.structures.add(fullStructure);
      }
      continue;
    }

    if (node.path.segments.some(segment => segment.kind === "catchAll")) {
      state.issues.push(
        `Group pattern cannot contain a catch-all segment: "${node.path.pattern}" (group id "${node.id}")`,
      );
    }

    walkValidate(node.routes, combinedPattern, fullStructure, state);
  }
}

export function validateManifest(routes: $ReadOnlyArray<RouteNode>): void {
  const state: ValidationState = {
    ids: new Set(),
    structures: new Set(),
    issues: [],
  };
  walkValidate(routes, "/", "", state);
  if (state.issues.length > 0) {
    throw new Error(`Invalid route manifest:\n  - ${state.issues.join("\n  - ")}`);
  }
}

const DEFAULT_MATCH_CACHE_CAPACITY = 256;

type MatchCacheEntry = { +match: ?RouteMatch };

class MatchCache {
  +map: Map<string, MatchCacheEntry>;
  +capacity: number;

  constructor(capacity: number): void {
    this.map = new Map();
    this.capacity = capacity;
  }

  get(key: string): ?MatchCacheEntry {
    const entry = this.map.get(key);
    if (entry == null) {
      return null;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, match: ?RouteMatch): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, { match });
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest != null) {
        this.map.delete(oldest);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

function matchCacheKey(input: string | URL): string {
  return typeof input === "string" ? input : input.toString();
}

class AppImpl implements App {
  id: string;
  routes: $ReadOnlyArray<RouteNode>;
  middleware: $ReadOnlyArray<Middleware>;
  document: $FlowFixMe;
  notFound: $FlowFixMe;
  _matchCache: MatchCache;

  constructor(options: AppOptions): void {
    validateManifest(options.routes);
    this.id = generateId("app");
    this.routes = options.routes;
    this.middleware = normalizeMiddleware(options.middleware);
    this.document = options.document ?? null;
    this.notFound = options.notFound ?? null;
    const capacity = options.matchCacheCapacity != null
      ? options.matchCacheCapacity
      : DEFAULT_MATCH_CACHE_CAPACITY;
    this._matchCache = new MatchCache(capacity);
  }

  match(url: string | URL): ?RouteMatch {
    const key = matchCacheKey(url);
    const cached = this._matchCache.get(key);
    if (cached != null) {
      return cached.match;
    }
    const result = matchRoute(this.routes, url);
    this._matchCache.set(key, result);
    return result;
  }

  clearMatchCache(): void {
    this._matchCache.clear();
  }

  paths(): $ReadOnlyArray<string> {
    const all: Array<string> = [];
    const emptyRoot: CompiledPath = compilePath("/");
    for (const node of this.routes) {
      flattenPaths(node, emptyRoot, all);
    }
    return all;
  }

  routeById(id: string): ?RouteNode {
    return findById(this.routes, id);
  }
}

export function app(options: AppOptions): App {
  return new AppImpl(options);
}
