/* @flow strict */

import {
  cell,
  transaction,
} from "flow-cell/server";
import type {
  Cell,
  Readable,
  Unsubscribe,
} from "flow-cell/server";
import {
  buildHref,
  serializeQuery,
} from "./Path";
import { matchRoute } from "./Match";
import type {
  AnyParams,
  AnyQuery,
  App,
  CompiledPath,
  Navigation,
  NavigationBeforeLeaveFn,
  NavigationDirection,
  NavigationEvent,
  NavigationTarget,
  NavigateOptions,
  RouteNode,
} from "./Types";

let nextNavigationId = 0;

function navigationKey(): string {
  nextNavigationId += 1;
  return `navigation.${String(nextNavigationId)}`;
}

function ensureUrl(value: string | URL, base?: URL): URL {
  if (typeof value !== "string") {
    return value;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return new URL(value);
  }
  const baseHref = base != null ? base.toString() : "http://flow-membrane.local";
  const path = value.startsWith("/") ? value : `/${value}`;
  return new URL(path, baseHref);
}

function resolveTarget(target: NavigationTarget, base?: URL): URL {
  if (typeof target === "string" || target instanceof URL) {
    return ensureUrl(target, base);
  }
  const search = serializeQuery(target.query);
  const hash = target.hash != null && target.hash !== "" ? `#${target.hash.replace(/^#/, "")}` : "";
  const path = target.to + search + hash;
  return ensureUrl(path, base);
}

export type NavigationOptions = {
  +initial?: URL,
};

class NavigationImpl implements Navigation {
  current: Cell<URL>;
  _pending: Cell<boolean>;
  _guards: Set<NavigationBeforeLeaveFn> = new Set();

  constructor(options?: NavigationOptions): void {
    const initial = options?.initial ?? new URL("/", "http://flow-membrane.local");
    this.current = cell<URL>(initial, { key: navigationKey(), name: "navigation.current" });
    this._pending = cell<boolean>(false, { key: navigationKey(), name: "navigation.pending" });
  }

  get pending(): Readable<boolean> {
    return this._pending;
  }

  beforeLeave(fn: NavigationBeforeLeaveFn): Unsubscribe {
    this._guards.add(fn);
    return () => {
      this._guards.delete(fn);
    };
  }

  async _confirmLeave(event: NavigationEvent): Promise<boolean> {
    for (const guardFn of Array.from(this._guards)) {
      const result = await guardFn(event);
      if (result === false) {
        return false;
      }
      if (typeof result === "string") {
        const g: $FlowFixMe = globalThis;
        if (typeof g.confirm === "function") {
          if (!g.confirm(result)) {
            return false;
          }
        }
      }
      if (!event.allowed()) {
        return false;
      }
    }
    return true;
  }

  async navigate(target: NavigationTarget, options?: NavigateOptions): Promise<void> {
    const previous = this.current.get();
    const next = resolveTarget(target, previous);
    if (next.toString() === previous.toString()) {
      return;
    }
    let cancelled = false;
    const event: NavigationEvent = {
      to: next,
      from: previous,
      direction: options?.replace === true ? "replace" : "push",
      cancel: () => {
        cancelled = true;
      },
      allowed: () => !cancelled,
    };
    transaction(() => {
      this._pending.set(true);
    });
    try {
      const ok = await this._confirmLeave(event);
      if (!ok || cancelled) {
        return;
      }
      transaction(() => {
        this.current.set(next);
      });
    } finally {
      transaction(() => {
        this._pending.set(false);
      });
    }
  }

  async reload(): Promise<void> {
    const next = new URL(this.current.get().toString());
    transaction(() => {
      this.current.set(next);
    });
  }

  back(): void {
    const g: $FlowFixMe = globalThis;
    if (g.history != null && typeof g.history.back === "function") {
      g.history.back();
    }
  }

  forward(): void {
    const g: $FlowFixMe = globalThis;
    if (g.history != null && typeof g.history.forward === "function") {
      g.history.forward();
    }
  }
}

export function createNavigation(options?: NavigationOptions): Navigation {
  return new NavigationImpl(options);
}

export function hrefFor(
  app: App,
  routeId: string,
  params: AnyParams,
  query?: AnyQuery,
  hash?: string,
): string {
  const node = app.routeById(routeId);
  if (node == null) {
    throw new Error(`Unknown route id: ${routeId}`);
  }
  const path: CompiledPath = collectPathFor(app, node);
  return buildHref(path, params, query, hash);
}

function collectPathFor(app: App, target: RouteNode): CompiledPath {
  const found = findPathWithAncestors(app.routes, target, []);
  if (found == null) {
    throw new Error(`Route node not in app manifest: ${target.id}`);
  }
  return found;
}

function findPathWithAncestors(
  nodes: $ReadOnlyArray<RouteNode>,
  target: RouteNode,
  ancestorPaths: $ReadOnlyArray<CompiledPath>,
): ?CompiledPath {
  for (const node of nodes) {
    const here = ancestorPaths.concat([node.path]);
    if (node === target || node.id === target.id) {
      return concatenate(here);
    }
    if (node.kind === "group") {
      const inner = findPathWithAncestors(node.routes, target, here);
      if (inner != null) {
        return inner;
      }
    }
  }
  return null;
}

function concatenate(paths: $ReadOnlyArray<CompiledPath>): CompiledPath {
  if (paths.length === 0) {
    return { pattern: "/", segments: [], paramNames: [] };
  }
  const segments = [];
  const paramNames = [];
  let pattern = "";
  for (const path of paths) {
    for (const segment of path.segments) {
      segments.push(segment);
    }
    for (const name of path.paramNames) {
      paramNames.push(name);
    }
    pattern += path.pattern === "/" ? "" : path.pattern;
  }
  if (pattern === "") {
    pattern = "/";
  }
  return { pattern, segments, paramNames };
}

export function previewMatch(
  app: App,
  target: NavigationTarget,
): ?{
  +url: URL,
  +pathname: string,
  +params: AnyParams,
  +query: AnyQuery,
  +routeId: string,
} {
  const url = resolveTarget(target);
  const match = matchRoute(app.routes, url);
  if (match == null) {
    return null;
  }
  return {
    url,
    pathname: match.pathname,
    params: match.params,
    query: match.query,
    routeId: match.route.id,
  };
}

function unusedDirectionType(_d: NavigationDirection): NavigationDirection {
  return _d;
}
unusedDirectionType("push");
