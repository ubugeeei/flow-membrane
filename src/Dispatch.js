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
import { parseCookieHeader } from "./Cookie";
import { awaitGenes } from "./Genes";
import { decodeQuery } from "./Path";
import type {
  AnyParams,
  AnyQuery,
  App,
  DispatchOptions,
  DispatchResult,
  Guard,
  HttpMethod,
  LayoutModule,
  Middleware,
  MiddlewareContext,
  QueryCodec,
  QueryCodecs,
  RequestLike,
  RouteContext,
  RouteMatch,
  RouteModule,
  RouteNode,
  RouteSignal,
  SessionLike,
  TelemetryHooks,
} from "./Types";

function nowMs(): number {
  const perf: $FlowFixMe = (globalThis as $FlowFixMe).performance;
  if (perf != null && typeof perf.now === "function") {
    return perf.now();
  }
  return Date.now();
}

function safeInvokeHook<T>(hook: ?(event: T) => mixed, event: T): void {
  if (hook == null) {
    return;
  }
  try {
    hook(event);
  } catch (_err) {
  }
}

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

function collectQueryCodecs(match: RouteMatch): QueryCodecs {
  const merged: { [string]: QueryCodec<mixed> } = {};
  for (const ancestor of match.ancestors) {
    for (const key of Object.keys(ancestor.queryCodecs)) {
      merged[key] = ancestor.queryCodecs[key];
    }
  }
  for (const key of Object.keys(match.route.queryCodecs)) {
    merged[key] = match.route.queryCodecs[key];
  }
  return (merged as $FlowFixMe as QueryCodecs);
}

function applyQueryCodecs(match: RouteMatch): RouteMatch | { +badRequest: string } {
  const codecMap = collectQueryCodecs(match);
  if (Object.keys(codecMap).length === 0) {
    return match;
  }
  try {
    const decoded: AnyQuery = decodeQuery(match.query, codecMap);
    return {
      route: match.route,
      pathname: match.pathname,
      params: match.params,
      query: decoded,
      ancestors: match.ancestors,
      matchedPath: match.matchedPath,
      signature: match.signature,
    };
  } catch (err) {
    return {
      badRequest: err != null && typeof (err as $FlowFixMe).message === "string"
        ? (err as $FlowFixMe).message
        : "Invalid query parameters.",
    };
  }
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
  return parseCookieHeader(typeof raw === "string" ? raw : "");
}

function buildContext(
  match: RouteMatch,
  url: URL,
  request: RequestLike,
  session: SessionLike,
  state: { +[string]: mixed },
  genes: mixed,
  signal: ?AbortSignal,
  method: HttpMethod,
  actionResult?: mixed,
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
    method,
    actionResult,
  };
}

function normalizeMethod(method: ?string): HttpMethod {
  if (method == null || typeof method !== "string" || method === "") {
    return "GET";
  }
  return method.toUpperCase();
}

function resolveMetadata(
  moduleConfig: $FlowFixMe,
  context: RouteContext<AnyParams, mixed>,
): mixed {
  if (moduleConfig == null) {
    return null;
  }
  const raw: mixed = moduleConfig.metadata;
  if (raw == null) {
    return null;
  }
  if (typeof raw === "function") {
    try {
      return (raw as $FlowFixMe)(context);
    } catch (_err) {
      return null;
    }
  }
  return raw;
}

function pickActionHandler(
  moduleConfig: $FlowFixMe,
  method: HttpMethod,
): ?(ctx: RouteContext<AnyParams, mixed>) => mixed {
  if (moduleConfig == null) {
    return null;
  }
  const actions: $FlowFixMe = moduleConfig.actions;
  if (actions != null && typeof actions === "object" && typeof actions[method] === "function") {
    return actions[method];
  }
  if (method !== "GET" && method !== "HEAD" && typeof moduleConfig.action === "function") {
    return moduleConfig.action;
  }
  return null;
}

function collectAllowedMethods(match: RouteMatch): ?$ReadOnlyArray<HttpMethod> {
  let merged: ?Array<HttpMethod> = null;
  for (const ancestor of match.ancestors) {
    if (ancestor.methods != null) {
      merged = merged == null
        ? Array.from(ancestor.methods)
        : merged.filter(m => ancestor.methods != null && ancestor.methods.includes(m));
    }
  }
  if (match.route.methods != null) {
    if (merged == null) {
      merged = Array.from(match.route.methods);
    } else {
      merged = merged.filter(m => match.route.methods != null && match.route.methods.includes(m));
    }
  }
  return merged;
}

type GuardOutcome = {
  +signal: ?RouteSignal,
  +blockingGuard: ?string,
  +appliedGuards: $ReadOnlyArray<string>,
};

async function runGuards(
  guards: $ReadOnlyArray<Guard<AnyParams>>,
  match: RouteMatch,
  url: URL,
  request: RequestLike,
  session: SessionLike,
  state: { +[string]: mixed },
  signal: ?AbortSignal,
  method: HttpMethod,
): Promise<GuardOutcome> {
  const matched = match.ancestors.map(ancestor => ancestor.id).concat([match.route.id]);
  const applied: Array<string> = [];
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
        method,
        appliedGuards: applied,
      });
    } catch (thrown) {
      const routeSignal = signalOf(thrown);
      if (routeSignal != null) {
        return { signal: routeSignal, blockingGuard: guardEntry.id, appliedGuards: applied };
      }
      throw thrown;
    }
    if (result === true) {
      applied.push(guardEntry.id);
      continue;
    }
    if (result === false) {
      return {
        signal: { kind: "forbidden" },
        blockingGuard: guardEntry.id,
        appliedGuards: applied,
      };
    }
    if (result != null && typeof result === "object" && typeof (result as $FlowFixMe).kind === "string") {
      return {
        signal: result as $FlowFixMe as RouteSignal,
        blockingGuard: guardEntry.id,
        appliedGuards: applied,
      };
    }
    applied.push(guardEntry.id);
  }
  return { signal: null, blockingGuard: null, appliedGuards: applied };
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

  const telemetry: ?TelemetryHooks = appHandle.telemetry ?? null;
  const startedAt = nowMs();
  const method: HttpMethod = normalizeMethod(request.method);

  const finalize = (result: DispatchResult): DispatchResult => {
    safeInvokeHook(telemetry?.onDispatchEnd, {
      url,
      method,
      result,
      durationMs: nowMs() - startedAt,
    });
    return result;
  };

  safeInvokeHook(telemetry?.onDispatchStart, { url, method });

  try {
    checkAborted(abortSignal);
  } catch (thrown) {
    safeInvokeHook(telemetry?.onDispatchEnd, {
      url,
      method,
      result: { kind: "notFound", signal: { kind: "notFound" } },
      durationMs: nowMs() - startedAt,
    });
    throw thrown;
  }

  const rawMatch = appHandle.match(url);
  if (rawMatch == null) {
    return finalize({ kind: "notFound", signal: { kind: "notFound" } });
  }
  safeInvokeHook(telemetry?.onMatch, { url, match: rawMatch });

  const decoded = applyQueryCodecs(rawMatch);
  if (decoded != null && typeof (decoded as $FlowFixMe).badRequest === "string") {
    return finalize({
      kind: "badRequest",
      signal: {
        kind: "badRequest",
        message: (decoded as $FlowFixMe).badRequest,
      },
    });
  }
  const match: RouteMatch = decoded as $FlowFixMe as RouteMatch;

  const session: SessionLike = options?.session ?? ({} as SessionLike);
  const baseState: { [string]: mixed } = options?.state != null
    ? ({ ...(options.state as $FlowFixMe) } as { [string]: mixed })
    : ({} as { [string]: mixed });

  const allowed = collectAllowedMethods(match);
  if (allowed != null && !allowed.includes(method)) {
    return finalize({
      kind: "methodNotAllowed",
      signal: {
        kind: "methodNotAllowed",
        method,
        allowed,
      },
    });
  }

  const middlewareContext: MiddlewareContext = {
    request,
    url,
    headers: buildHeaders(request),
    cookies: buildCookies(request),
    session,
    state: baseState,
    signal: abortSignal,
    method,
  };

  const middlewares: Array<Middleware> = [];
  for (const entry of appHandle.middleware) {
    middlewares.push(entry);
  }
  for (const entry of collectRouteMiddleware(match)) {
    middlewares.push(entry);
  }

  let outcome: ?DispatchResult = null;
  let appliedSoFar: $ReadOnlyArray<string> = [];

  try {
    await runMiddlewareChain(middlewares, middlewareContext, async () => {
      checkAborted(abortSignal);
      const guards = collectRouteGuards(match);
      const guardOutcome = await runGuards(
        guards,
        match,
        url,
        request,
        session,
        middlewareContext.state,
        abortSignal,
        method,
      );
      appliedSoFar = guardOutcome.appliedGuards;
      if (guardOutcome.signal != null) {
        const guardSignal: RouteSignal = guardOutcome.signal;
        const blockingGuard = guardOutcome.blockingGuard ?? undefined;
        if (guardSignal.kind === "redirect") {
          outcome = { kind: "redirect", signal: guardSignal, blockingGuard };
          return;
        }
        if (guardSignal.kind === "forbidden") {
          outcome = { kind: "forbidden", signal: guardSignal, blockingGuard };
          return;
        }
        if (guardSignal.kind === "badRequest") {
          outcome = { kind: "badRequest", signal: guardSignal, blockingGuard };
          return;
        }
        if (guardSignal.kind === "methodNotAllowed") {
          outcome = { kind: "methodNotAllowed", signal: guardSignal, blockingGuard };
          return;
        }
        outcome = { kind: "notFound", signal: guardSignal, blockingGuard };
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
      let actionResult: mixed = undefined;
      if (moduleConfig != null) {
        const tempContext = buildContext(
          match,
          url,
          request,
          session,
          middlewareContext.state,
          {},
          abortSignal,
          method,
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
              method,
              appliedGuards: appliedSoFar,
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
        if (configGuardSignal == null) {
          const handler: ?(ctx: RouteContext<AnyParams, mixed>) => mixed = pickActionHandler(
            moduleConfig,
            method,
          );
          if (handler != null) {
            try {
              actionResult = await handler(tempContext);
            } catch (thrown) {
              const sig = signalOf(thrown);
              if (sig != null) {
                configGuardSignal = sig;
              } else {
                throw thrown;
              }
            }
            checkAborted(abortSignal);
          }
        }
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
        if (configGuardSignal == null && options?.awaitGenes === true && genes != null) {
          checkAborted(abortSignal);
          try {
            genes = await awaitGenes(genes);
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
        const blockingGuard = `${match.route.id}:config`;
        if (configGuardSignal.kind === "redirect") {
          outcome = { kind: "redirect", signal: configGuardSignal, blockingGuard };
        } else if (configGuardSignal.kind === "forbidden") {
          outcome = { kind: "forbidden", signal: configGuardSignal, blockingGuard };
        } else if (configGuardSignal.kind === "badRequest") {
          outcome = { kind: "badRequest", signal: configGuardSignal, blockingGuard };
        } else if (configGuardSignal.kind === "methodNotAllowed") {
          outcome = { kind: "methodNotAllowed", signal: configGuardSignal, blockingGuard };
        } else {
          outcome = { kind: "notFound", signal: configGuardSignal, blockingGuard };
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
        method,
        actionResult,
      );
      const metadata: mixed = resolveMetadata(moduleConfig, context);
      outcome = {
        kind: "render",
        render: {
          match,
          module: module as $FlowFixMe as RouteModule<AnyParams, mixed>,
          layouts,
          context,
          metadata,
        },
      };
    });
  } catch (thrown) {
    if (isSignalError(thrown)) {
      const sig = signalOf(thrown);
      if (sig != null) {
        if (sig.kind === "redirect") {
          return finalize({ kind: "redirect", signal: sig });
        }
        if (sig.kind === "forbidden") {
          return finalize({ kind: "forbidden", signal: sig });
        }
        if (sig.kind === "badRequest") {
          return finalize({ kind: "badRequest", signal: sig });
        }
        if (sig.kind === "methodNotAllowed") {
          return finalize({ kind: "methodNotAllowed", signal: sig });
        }
        return finalize({ kind: "notFound", signal: sig });
      }
    }
    if (isRedirect(thrown)) {
      return finalize({ kind: "redirect", signal: thrown as $FlowFixMe });
    }
    safeInvokeHook(telemetry?.onDispatchEnd, {
      url,
      method,
      result: { kind: "notFound", signal: { kind: "notFound" } },
      durationMs: nowMs() - startedAt,
    });
    throw thrown;
  }

  if (outcome == null) {
    return finalize({ kind: "notFound", signal: { kind: "notFound" } });
  }
  return finalize(outcome);
}
