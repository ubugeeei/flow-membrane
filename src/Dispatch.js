/* @flow strict */

import {
  isRedirect,
  isSignalError,
  signalOf,
} from "./Signals";
import {
  checkAborted,
  resolveSignal,
} from "./Abort";
import type {
  AnyParams,
  App,
  DispatchOptions,
  DispatchResult,
  Guard,
  LayoutModule,
  Middleware,
  MiddlewareContext,
  RequestLike,
  RouteContext,
  RouteMatch,
  RouteModule,
  RouteNode,
  RouteSignal,
  SessionLike,
} from "./Types";

function ensureRequest(url: URL, options?: DispatchOptions): RequestLike {
  if (options?.request != null) {
    return options.request;
  }
  return {
    url: url.toString(),
    method: "GET",
    headers: {},
  };
}

function collectRouteGuards(match: RouteMatch): Array<Guard<AnyParams>> {
  const guards: Array<Guard<AnyParams>> = [];
  for (const ancestor of match.ancestors) {
    for (const ancestorGuard of ancestor.guards) {
      guards.push(ancestorGuard);
    }
  }
  for (const routeGuard of match.route.guards) {
    guards.push(routeGuard);
  }
  return guards;
}

function collectRouteMiddleware(match: RouteMatch): Array<Middleware> {
  const all: Array<Middleware> = [];
  for (const ancestor of match.ancestors) {
    for (const entry of ancestor.middleware) {
      all.push(entry);
    }
  }
  for (const entry of match.route.middleware) {
    all.push(entry);
  }
  return all;
}

async function runMiddlewareChain(
  middlewares: $ReadOnlyArray<Middleware>,
  context: MiddlewareContext,
  terminal: () => Promise<mixed> | mixed,
): Promise<mixed> {
  let index = -1;
  const run = async (cursor: number): Promise<mixed> => {
    if (cursor <= index) {
      throw new Error("Middleware called next() multiple times.");
    }
    index = cursor;
    const handler = middlewares[cursor];
    if (handler == null) {
      return terminal();
    }
    return handler.run(context, () => run(cursor + 1));
  };
  return run(0);
}

async function loadAncestorLayouts(
  ancestors: $ReadOnlyArray<RouteNode>,
): Promise<Array<LayoutModule>> {
  const layouts: Array<LayoutModule> = [];
  for (const node of ancestors) {
    if (node.kind === "group" && node.layout != null) {
      const mod = await node.layout.load();
      layouts.push(mod as LayoutModule);
    }
  }
  return layouts;
}

function buildHeaders(request: RequestLike): { +[string]: string } {
  if (request.headers != null) {
    return request.headers;
  }
  const empty: { +[string]: string } = {};
  return empty;
}

function buildCookies(request: RequestLike): { +[string]: string } {
  const headers = buildHeaders(request);
  const raw = headers["cookie"] ?? headers["Cookie"] ?? "";
  if (raw === "" || typeof raw !== "string") {
    const empty: { +[string]: string } = {};
    return empty;
  }
  const out: { [string]: string } = {};
  for (const part of raw.split(";")) {
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

function buildContext(
  match: RouteMatch,
  url: URL,
  request: RequestLike,
  session: SessionLike,
  state: { +[string]: mixed },
  genes: mixed,
  signal: ?AbortSignal,
): RouteContext<AnyParams, mixed> {
  return {
    id: match.route.id,
    pathname: match.pathname,
    params: match.params,
    query: match.query,
    url,
    genes: genes ?? ({} as $FlowFixMe),
    session,
    request,
    state,
    signal,
  };
}

async function runGuards(
  guards: $ReadOnlyArray<Guard<AnyParams>>,
  match: RouteMatch,
  url: URL,
  request: RequestLike,
  session: SessionLike,
  state: { +[string]: mixed },
  signal: ?AbortSignal,
): Promise<?RouteSignal> {
  const matched = match.ancestors.map(ancestor => ancestor.id).concat([match.route.id]);
  for (const guardEntry of guards) {
    checkAborted(signal);
    let result;
    try {
      result = await guardEntry.run({
        params: match.params,
        url,
        request,
        session,
        state,
        matched,
        signal,
      });
    } catch (thrown) {
      const routeSignal = signalOf(thrown);
      if (routeSignal != null) {
        return routeSignal;
      }
      throw thrown;
    }
    if (result === true) {
      continue;
    }
    if (result === false) {
      return { kind: "forbidden" };
    }
    if (result != null && typeof result === "object" && typeof (result as $FlowFixMe).kind === "string") {
      return result as $FlowFixMe as RouteSignal;
    }
  }
  return null;
}

export async function dispatch(
  appHandle: App,
  input: string | URL,
  options?: DispatchOptions,
): Promise<DispatchResult> {
  const url = typeof input === "string"
    ? new URL(input, "http://flow-membrane.local")
    : input;

  const request = ensureRequest(url, options);
  const abortSignal: ?AbortSignal = resolveSignal(
    options?.signal,
    request.signal,
  );
  checkAborted(abortSignal);

  const match = appHandle.match(url);
  if (match == null) {
    return { kind: "notFound", signal: { kind: "notFound" } };
  }

  const session: SessionLike = options?.session ?? ({} as SessionLike);
  const baseState: { [string]: mixed } = options?.state != null
    ? ({ ...(options.state as $FlowFixMe) } as { [string]: mixed })
    : ({} as { [string]: mixed });

  const middlewareContext: MiddlewareContext = {
    request,
    url,
    headers: buildHeaders(request),
    cookies: buildCookies(request),
    session,
    state: baseState,
    signal: abortSignal,
  };

  const middlewares: Array<Middleware> = [];
  for (const entry of appHandle.middleware) {
    middlewares.push(entry);
  }
  for (const entry of collectRouteMiddleware(match)) {
    middlewares.push(entry);
  }

  let outcome: ?DispatchResult = null;

  try {
    await runMiddlewareChain(middlewares, middlewareContext, async () => {
      checkAborted(abortSignal);
      const guards = collectRouteGuards(match);
      const guardSignal = await runGuards(
        guards,
        match,
        url,
        request,
        session,
        middlewareContext.state,
        abortSignal,
      );
      if (guardSignal != null) {
        if (guardSignal.kind === "redirect") {
          outcome = { kind: "redirect", signal: guardSignal };
          return;
        }
        if (guardSignal.kind === "forbidden") {
          outcome = { kind: "forbidden", signal: guardSignal };
          return;
        }
        outcome = { kind: "notFound", signal: guardSignal };
        return;
      }

      const routeNode = match.route;
      if (routeNode.kind !== "route") {
        outcome = { kind: "notFound", signal: { kind: "notFound" } };
        return;
      }
      checkAborted(abortSignal);
      const module = await routeNode.module.load();
      checkAborted(abortSignal);
      const layouts = await loadAncestorLayouts(match.ancestors);
      checkAborted(abortSignal);

      const moduleConfig = (module as $FlowFixMe).config;
      let genes: mixed = {};
      let configGuardSignal: ?RouteSignal = null;
      if (moduleConfig != null) {
        const tempContext = buildContext(
          match,
          url,
          request,
          session,
          middlewareContext.state,
          {},
          abortSignal,
        );
        if (typeof moduleConfig.guard === "function") {
          try {
            const result = await moduleConfig.guard({
              params: tempContext.params,
              url,
              request,
              session,
              state: middlewareContext.state,
              matched: match.ancestors.map(a => a.id).concat([match.route.id]),
              signal: abortSignal,
            });
            if (result === false) {
              configGuardSignal = { kind: "forbidden" };
            } else if (
              result !== true &&
              result != null &&
              typeof result === "object" &&
              typeof (result as $FlowFixMe).kind === "string"
            ) {
              configGuardSignal = result as $FlowFixMe as RouteSignal;
            }
          } catch (thrown) {
            const sig = signalOf(thrown);
            if (sig != null) {
              configGuardSignal = sig;
            } else {
              throw thrown;
            }
          }
        }
        checkAborted(abortSignal);
        if (configGuardSignal == null && typeof moduleConfig.genes === "function") {
          try {
            genes = moduleConfig.genes(tempContext);
          } catch (thrown) {
            const sig = signalOf(thrown);
            if (sig != null) {
              configGuardSignal = sig;
            } else {
              throw thrown;
            }
          }
        }
      }

      if (configGuardSignal != null) {
        if (configGuardSignal.kind === "redirect") {
          outcome = { kind: "redirect", signal: configGuardSignal };
        } else if (configGuardSignal.kind === "forbidden") {
          outcome = { kind: "forbidden", signal: configGuardSignal };
        } else {
          outcome = { kind: "notFound", signal: configGuardSignal };
        }
        return;
      }

      const context = buildContext(
        match,
        url,
        request,
        session,
        middlewareContext.state,
        genes,
        abortSignal,
      );
      outcome = {
        kind: "render",
        render: {
          match,
          module: module as $FlowFixMe as RouteModule<AnyParams, mixed>,
          layouts,
          context,
        },
      };
    });
  } catch (thrown) {
    if (isSignalError(thrown)) {
      const sig = signalOf(thrown);
      if (sig != null) {
        if (sig.kind === "redirect") {
          return { kind: "redirect", signal: sig };
        }
        if (sig.kind === "forbidden") {
          return { kind: "forbidden", signal: sig };
        }
        return { kind: "notFound", signal: sig };
      }
    }
    if (isRedirect(thrown)) {
      return { kind: "redirect", signal: thrown as $FlowFixMe };
    }
    throw thrown;
  }

  if (outcome == null) {
    return { kind: "notFound", signal: { kind: "notFound" } };
  }
  return outcome;
}
