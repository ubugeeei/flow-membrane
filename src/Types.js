/* @flow strict */

import type * as React from "react";
import type {
  Cell,
  Readable,
  Unsubscribe,
} from "flow-cell/server";

export type AnyParams = { +[string]: mixed };
export type AnyQuery = { +[string]: mixed };
export type RawQuery = { +[string]: string | $ReadOnlyArray<string> };

export type ParamCodec<T> = {
  +parse: (raw: string) => T,
  +serialize: (value: T) => string,
  +name: string,
};

export type ParamCodecs = { +[string]: ParamCodec<mixed> };

export type QueryCodec<T> = {
  +parse: (raw: ?(string | $ReadOnlyArray<string>)) => T,
  +serialize: (value: T) => ?(string | $ReadOnlyArray<string>),
  +name: string,
};

export type QueryCodecs = { +[string]: QueryCodec<mixed> };

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
  +invalidate: () => void;
}

export type RequestLike = {
  +url: string,
  +method?: string,
  +headers?: { +[string]: string },
  +signal?: AbortSignal,
  ...
};

export type SessionLike = { +[string]: mixed };

export type HttpMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | string;

export type MiddlewareContext = {
  request: RequestLike,
  url: URL,
  headers: { +[string]: string },
  cookies: { +[string]: string },
  session: SessionLike,
  state: { [string]: mixed },
  +signal: ?AbortSignal,
  +method: HttpMethod,
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
  +method: HttpMethod,
  +appliedGuards: $ReadOnlyArray<string>,
};

export type GuardResult =
  | true
  | false
  | RedirectSignal
  | NotFoundSignal
  | ForbiddenSignal
  | BadRequestSignal
  | MethodNotAllowedSignal;

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
  +setCookies?: $ReadOnlyArray<string>,
};

export type NotFoundSignal = {
  +kind: "notFound",
  +message?: string,
};

export type ForbiddenSignal = {
  +kind: "forbidden",
  +message?: string,
};

export type BadRequestSignal = {
  +kind: "badRequest",
  +message?: string,
  +cause?: mixed,
};

export type MethodNotAllowedSignal = {
  +kind: "methodNotAllowed",
  +method: HttpMethod,
  +allowed: $ReadOnlyArray<HttpMethod>,
  +message?: string,
};

export type RouteSignal =
  | RedirectSignal
  | NotFoundSignal
  | ForbiddenSignal
  | BadRequestSignal
  | MethodNotAllowedSignal;

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

export type ActionFn<Params: AnyParams = AnyParams> = (
  context: RouteContext<Params, {}>,
) => Promise<mixed> | mixed;

export type ActionsConfig<Params: AnyParams = AnyParams> = {
  +[method: HttpMethod]: ActionFn<Params>,
};

export type MembraneConfig<Params: AnyParams = AnyParams, Genes = {}> = {
  +prerender?: PrerenderConfig<Params>,
  +genes?: GenesLoader<Params, Genes>,
  +guard?: GuardFn<Params>,
  +boundary?: BoundaryConfig,
  +metadata?: ((context: RouteContext<Params, {}>) => mixed) | mixed,
  +revalidate?: Revalidate,
  +action?: ActionFn<Params>,
  +actions?: ActionsConfig<Params>,
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
  +method: HttpMethod,
  +actionResult?: mixed,
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
  +query?: QueryCodecs,
  +methods?: $ReadOnlyArray<HttpMethod>,
  +module: Lazy<RouteModule<Params, mixed>>,
  +guard?: Guard<Params> | GuardFn<Params>,
  +middleware?: $ReadOnlyArray<Middleware | MiddlewareFn>,
};

export type GroupOptions<Params: AnyParams = AnyParams> = {
  +id?: string,
  +params?: ParamCodecs,
  +query?: QueryCodecs,
  +methods?: $ReadOnlyArray<HttpMethod>,
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
      +queryCodecs: QueryCodecs,
      +methods: ?$ReadOnlyArray<HttpMethod>,
    }
  | {
      +kind: "group",
      +id: string,
      +path: CompiledPath,
      +layout?: Lazy<LayoutModule>,
      +guards: $ReadOnlyArray<Guard<AnyParams>>,
      +middleware: $ReadOnlyArray<Middleware>,
      +paramCodecs: ParamCodecs,
      +queryCodecs: QueryCodecs,
      +methods: ?$ReadOnlyArray<HttpMethod>,
      +routes: $ReadOnlyArray<RouteNode>,
    };

export type AppOptions = {
  +document?: Lazy<DocumentModule>,
  +middleware?: $ReadOnlyArray<Middleware | MiddlewareFn>,
  +routes: $ReadOnlyArray<RouteNode>,
  +notFound?: Lazy<RouteModule<AnyParams, mixed>>,
  +matchCacheCapacity?: number,
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
  clearMatchCache(): void;
}

export type RouteMatch = {
  +route: RouteNode,
  +pathname: string,
  +params: AnyParams,
  +query: AnyQuery,
  +ancestors: $ReadOnlyArray<RouteNode>,
  +matchedPath: string,
  +signature: string,
};

export type DispatchOptions = {
  +request?: RequestLike,
  +session?: SessionLike,
  +state?: { +[string]: mixed },
  +signal?: AbortSignal,
  +awaitGenes?: boolean,
};

export type RouteMetadata = {
  +title?: string,
  +description?: string,
  +canonical?: string,
  +robots?: string,
  +og?: { +[string]: string },
  +twitter?: { +[string]: string },
  +meta?: $ReadOnlyArray<{ +name?: string, +property?: string, +content: string }>,
  +link?: $ReadOnlyArray<{ +rel: string, +href: string, +[string]: mixed }>,
  ...
};

export type ResolvedRender = {
  +match: RouteMatch,
  +module: RouteModule<AnyParams, mixed>,
  +layouts: $ReadOnlyArray<LayoutModule>,
  +context: RouteContext<AnyParams, mixed>,
  +metadata: mixed,
};

export type DispatchResult =
  | { +kind: "render", +render: ResolvedRender }
  | { +kind: "redirect", +signal: RedirectSignal, +blockingGuard?: string }
  | { +kind: "notFound", +signal: NotFoundSignal, +blockingGuard?: string }
  | { +kind: "forbidden", +signal: ForbiddenSignal, +blockingGuard?: string }
  | { +kind: "badRequest", +signal: BadRequestSignal, +blockingGuard?: string }
  | {
      +kind: "methodNotAllowed",
      +signal: MethodNotAllowedSignal,
      +blockingGuard?: string,
    };

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

export type ScrollPosition = { +x: number, +y: number };

export type ScrollBehavior = "restore" | "top" | "preserve";

export interface Navigation {
  +current: Cell<URL>;
  +pending: Readable<boolean>;
  beforeLeave(fn: NavigationBeforeLeaveFn): Unsubscribe;
  navigate(target: NavigationTarget, options?: NavigateOptions): Promise<void>;
  reload(): Promise<void>;
  back(): void;
  forward(): void;
  saveScroll(url: URL | string, position: ScrollPosition): void;
  getScroll(url: URL | string): ?ScrollPosition;
  notifyPop(url: URL | string): Promise<void>;
}

export type NavigateOptions = {
  +replace?: boolean,
  +scroll?: ScrollBehavior,
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
