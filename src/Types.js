/* @flow strict */

import type * as React from "react";
import type {
  Cell,
  Readable,
  Unsubscribe,
} from "flow-cell/server";

export type AnyParams = { +[string]: mixed };
export type AnyQuery = { +[string]: string | $ReadOnlyArray<string> };

export type ParamCodec<T> = {
  +parse: (raw: string) => T,
  +serialize: (value: T) => string,
  +name: string,
};

export type ParamCodecs = { +[string]: ParamCodec<mixed> };

export type CompiledSegment =
  | { +kind: "literal", +value: string }
  | { +kind: "param", +name: string, +codec: ?ParamCodec<mixed> }
  | { +kind: "catchAll", +name: string };

export type CompiledPath = {
  +pattern: string,
  +segments: $ReadOnlyArray<CompiledSegment>,
  +paramNames: $ReadOnlyArray<string>,
};

export type LazyState<T> =
  | { +status: "idle" }
  | { +status: "loading", +promise: Promise<T> }
  | { +status: "loaded", +value: T }
  | { +status: "rejected", +error: mixed };

export interface Lazy<T> {
  +load: () => Promise<T>;
  +read: () => T;
  +peek: () => ?T;
  +preload: () => Promise<T>;
  +state: () => LazyState<T>;
}

export type RequestLike = {
  +url: string,
  +method?: string,
  +headers?: { +[string]: string },
  +signal?: AbortSignal,
  ...
};

export type SessionLike = { +[string]: mixed };

export type MiddlewareContext = {
  request: RequestLike,
  url: URL,
  headers: { +[string]: string },
  cookies: { +[string]: string },
  session: SessionLike,
  state: { [string]: mixed },
  +signal: ?AbortSignal,
};

export type MiddlewareNext = () => Promise<mixed> | mixed;
export type MiddlewareFn = (
  context: MiddlewareContext,
  next: MiddlewareNext,
) => Promise<mixed> | mixed;

export type Middleware = {
  +kind: "middleware",
  +id: string,
  +run: MiddlewareFn,
};

export type GuardContext<Params: AnyParams = AnyParams> = {
  +params: Params,
  +url: URL,
  +request: RequestLike,
  +session: SessionLike,
  +state: { +[string]: mixed },
  +matched: $ReadOnlyArray<string>,
  +signal: ?AbortSignal,
};

export type GuardResult =
  | true
  | false
  | RedirectSignal
  | NotFoundSignal
  | ForbiddenSignal;

export type GuardFn<Params: AnyParams = AnyParams> = (
  context: GuardContext<Params>,
) => GuardResult | Promise<GuardResult>;

export type Guard<Params: AnyParams = AnyParams> = {
  +kind: "guard",
  +id: string,
  +run: GuardFn<Params>,
};

export type RedirectSignal = {
  +kind: "redirect",
  +to: string,
  +status: 301 | 302 | 303 | 307 | 308,
  +headers?: { +[string]: string },
};

export type NotFoundSignal = {
  +kind: "notFound",
  +message?: string,
};

export type ForbiddenSignal = {
  +kind: "forbidden",
  +message?: string,
};

export type RouteSignal = RedirectSignal | NotFoundSignal | ForbiddenSignal;

export type Revalidate = "never" | string | number;

export type PrerenderPaths<Params: AnyParams = AnyParams> =
  | $ReadOnlyArray<Params>
  | (() => Promise<$ReadOnlyArray<Params>> | $ReadOnlyArray<Params>);

export type PrerenderConfig<Params: AnyParams = AnyParams> = {
  +paths?: PrerenderPaths<Params>,
  +revalidate?: Revalidate,
  +fallback?: "static" | "dynamic" | "blocking",
};

export type GenesLoader<Params: AnyParams, Genes> = (
  context: RouteContext<Params, {}>,
) => Genes;

export type BoundaryConfig = {
  +loading?: React.ComponentType<{}>,
  +error?: React.ComponentType<{ +error: mixed, +reset: () => void }>,
  +notFound?: React.ComponentType<{}>,
  +forbidden?: React.ComponentType<{}>,
};

export type MembraneConfig<Params: AnyParams = AnyParams, Genes = {}> = {
  +prerender?: PrerenderConfig<Params>,
  +genes?: GenesLoader<Params, Genes>,
  +guard?: GuardFn<Params>,
  +boundary?: BoundaryConfig,
  +metadata?: ((context: RouteContext<Params, {}>) => mixed) | mixed,
  +revalidate?: Revalidate,
};

export type RouteContext<Params: AnyParams = AnyParams, Genes = {}> = {
  +id: string,
  +pathname: string,
  +params: Params,
  +query: AnyQuery,
  +url: URL,
  +genes: Genes,
  +session: SessionLike,
  +request: RequestLike,
  +state: { +[string]: mixed },
  +signal: ?AbortSignal,
};

export type RouteModule<Params: AnyParams = AnyParams, Genes = {}> = {
  +config?: MembraneConfig<Params, Genes>,
  +default: React.ComponentType<RouteContext<Params, Genes>>,
  ...
};

export type LayoutModule = {
  +default: React.ComponentType<{ +children: React.Node }>,
  ...
};

export type DocumentModule = {
  +default: React.ComponentType<{ +children: React.Node }>,
  ...
};

export type RouteOptions<Params: AnyParams = AnyParams> = {
  +id?: string,
  +params?: ParamCodecs,
  +module: Lazy<RouteModule<Params, mixed>>,
  +guard?: Guard<Params> | GuardFn<Params>,
  +middleware?: $ReadOnlyArray<Middleware | MiddlewareFn>,
};

export type GroupOptions<Params: AnyParams = AnyParams> = {
  +id?: string,
  +params?: ParamCodecs,
  +layout?: Lazy<LayoutModule>,
  +guard?: Guard<Params> | GuardFn<Params>,
  +middleware?: $ReadOnlyArray<Middleware | MiddlewareFn>,
  +routes: $ReadOnlyArray<RouteNode>,
};

export type RouteNode =
  | {
      +kind: "route",
      +id: string,
      +path: CompiledPath,
      +module: Lazy<RouteModule<AnyParams, mixed>>,
      +guards: $ReadOnlyArray<Guard<AnyParams>>,
      +middleware: $ReadOnlyArray<Middleware>,
      +paramCodecs: ParamCodecs,
    }
  | {
      +kind: "group",
      +id: string,
      +path: CompiledPath,
      +layout?: Lazy<LayoutModule>,
      +guards: $ReadOnlyArray<Guard<AnyParams>>,
      +middleware: $ReadOnlyArray<Middleware>,
      +paramCodecs: ParamCodecs,
      +routes: $ReadOnlyArray<RouteNode>,
    };

export type AppOptions = {
  +document?: Lazy<DocumentModule>,
  +middleware?: $ReadOnlyArray<Middleware | MiddlewareFn>,
  +routes: $ReadOnlyArray<RouteNode>,
  +notFound?: Lazy<RouteModule<AnyParams, mixed>>,
};

export interface App {
  +id: string;
  +routes: $ReadOnlyArray<RouteNode>;
  +middleware: $ReadOnlyArray<Middleware>;
  +document?: Lazy<DocumentModule>;
  +notFound?: Lazy<RouteModule<AnyParams, mixed>>;
  match(url: string | URL): ?RouteMatch;
  paths(): $ReadOnlyArray<string>;
  routeById(id: string): ?RouteNode;
}

export type RouteMatch = {
  +route: RouteNode,
  +pathname: string,
  +params: AnyParams,
  +query: AnyQuery,
  +ancestors: $ReadOnlyArray<RouteNode>,
  +matchedPath: string,
};

export type DispatchOptions = {
  +request?: RequestLike,
  +session?: SessionLike,
  +state?: { +[string]: mixed },
  +signal?: AbortSignal,
};

export type ResolvedRender = {
  +match: RouteMatch,
  +module: RouteModule<AnyParams, mixed>,
  +layouts: $ReadOnlyArray<LayoutModule>,
  +context: RouteContext<AnyParams, mixed>,
};

export type DispatchResult =
  | { +kind: "render", +render: ResolvedRender }
  | { +kind: "redirect", +signal: RedirectSignal }
  | { +kind: "notFound", +signal: NotFoundSignal }
  | { +kind: "forbidden", +signal: ForbiddenSignal };

export type NavigationTarget = string | URL | {
  +to: string,
  +params?: AnyParams,
  +query?: AnyQuery,
  +hash?: string,
};

export type NavigationDirection = "push" | "replace" | "pop";

export type NavigationEvent = {
  +to: URL,
  +from: ?URL,
  +direction: NavigationDirection,
  +cancel: () => void,
  +allowed: () => boolean,
};

export type NavigationBeforeLeaveFn = (
  event: NavigationEvent,
) => boolean | string | Promise<boolean | string>;

export interface Navigation {
  +current: Cell<URL>;
  +pending: Readable<boolean>;
  beforeLeave(fn: NavigationBeforeLeaveFn): Unsubscribe;
  navigate(target: NavigationTarget, options?: NavigateOptions): Promise<void>;
  reload(): Promise<void>;
  back(): void;
  forward(): void;
}

export type NavigateOptions = {
  +replace?: boolean,
  +scroll?: "restore" | "top" | "preserve",
  +transition?: boolean,
  +data?: mixed,
};

export type LinkProps = {
  +to: NavigationTarget,
  +prefetch?: "intent" | "render" | "viewport" | "none",
  +replace?: boolean,
  +scroll?: "restore" | "top" | "preserve",
  +children?: React.Node,
  +className?: string,
  +style?: { +[string]: mixed },
  +onClick?: (event: SyntheticMouseEvent<HTMLAnchorElement>) => mixed,
  ...
};

export type RouteIdHelper = {
  <T>(): ParamCodec<T>,
  string(): ParamCodec<string>,
  int(): ParamCodec<number>,
  uuid(): ParamCodec<string>,
};
