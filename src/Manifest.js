/* @flow strict */

import {
  attachCodecs,
  combinePaths,
  compilePath,
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

class AppImpl implements App {
  id: string;
  routes: $ReadOnlyArray<RouteNode>;
  middleware: $ReadOnlyArray<Middleware>;
  document: $FlowFixMe;
  notFound: $FlowFixMe;

  constructor(options: AppOptions): void {
    this.id = generateId("app");
    this.routes = options.routes;
    this.middleware = normalizeMiddleware(options.middleware);
    this.document = options.document ?? null;
    this.notFound = options.notFound ?? null;
  }

  match(url: string | URL): ?RouteMatch {
    return matchRoute(this.routes, url);
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
