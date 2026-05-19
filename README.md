# FlowMembrane

> Experimental: FlowMembrane is an early, experimental routing / RSC boundary layer for the FlowCell ecosystem. APIs may change while the manifest and dispatcher settle.

FlowMembrane is an explicit-manifest router for React 19. There is no filesystem router, no special file names; the only entrypoint is `src/app.js`. The manifest carries the full route graph, layout groups, middleware chain, guards, lazy module loaders, and `membrane()` route config for prerender / genes / boundary policy. At request time `dispatch()` walks the chain and returns either a render plan, a redirect, a not-found, or a forbidden signal.

The biology metaphor:

- `flow-cell` — client state cells.
- `flow-gene` — GraphQL data contract.
- `flow-membrane` — the membrane managing static / dynamic / server / client / navigation boundaries.

## Explicit manifest

```js
import {
  app,
  codecs,
  group,
  guard,
  lazy,
  middleware,
  route,
} from "flow-membrane";

export default app({
  document: lazy(() => import("./document.js")),

  middleware: [
    middleware(async (ctx, next) => {
      ctx.state.locale = ctx.headers["accept-language"] ?? "en";
      return next();
    }),
  ],

  routes: [
    route("/", {
      id: "home",
      module: lazy(() => import("./routes/home.route.js")),
    }),

    route("/products/:id", {
      id: "product.show",
      params: { id: codecs.id() },
      module: lazy(() => import("./routes/product.route.js")),
    }),

    group("/dashboard", {
      id: "dashboard",
      guard: guard(async ({ session }) => session.user != null),
      layout: lazy(() => import("./layouts/dashboard.layout.js")),
      routes: [
        route("/", {
          id: "dashboard.home",
          module: lazy(() => import("./routes/dashboard.route.js")),
        }),
      ],
    }),
  ],
});
```

## Route capsule

```js
import { membrane, notFound } from "flow-membrane";
import { gql } from "flow-gene";
import { use } from "react";

const ProductPageQuery = gql.query`
  query ProductPageQuery($id: ID!) {
    product(id: $id) {
      id
      name
      ...ProductHero_product
    }
  }
`;

export const config = membrane({
  prerender: { revalidate: "1h" },
  genes: ({ params }) => ({
    product: ProductPageQuery.load({ id: params.id }),
  }),
});

export default function ProductRoute(ctx) {
  const data = use(ctx.genes.product);
  if (data.product == null) {
    notFound();
  }
  return <h1>{data.product.name}</h1>;
}
```

## Dispatch

The `dispatch()` function runs middleware, guards, loads the route module, and returns a typed result. Hosting glue (Node HTTP, RSC, edge) is intentionally outside the library.

```js
import { dispatch, isRedirect } from "flow-membrane";
import appManifest from "./app.js";

export async function handle(request) {
  const result = await dispatch(appManifest, request.url, {
    request,
    session: await readSession(request),
  });

  if (result.kind === "redirect") {
    return Response.redirect(result.signal.to, result.signal.status);
  }
  if (result.kind === "notFound") {
    return new Response("Not found", { status: 404 });
  }
  if (result.kind === "forbidden") {
    return new Response("Forbidden", { status: 403 });
  }
  if (result.kind === "badRequest") {
    return new Response(result.signal.message ?? "Bad request", { status: 400 });
  }
  if (result.kind === "methodNotAllowed") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: result.signal.allowed.join(", ") },
    });
  }

  // result.kind === "render"
  return renderToResponse(result.render);
}
```

### Progressive dispatch

`dispatchEvents()` exposes the dispatch lifecycle as an async iterable so a host can start streaming an HTML shell before the full render plan is ready:

```js
for await (const event of dispatchEvents(app, request.url)) {
  if (event.kind === "matched") /* start streaming shell */;
  if (event.kind === "moduleLoaded") /* swap in route chunk */;
  if (event.kind === "ready") return event.result;
}
```

`prefetchRoute(app, url)` matches the URL and preloads the route module + ancestor layouts in parallel without running middleware/guards/actions. Use it for SSR warm-up, hover-on-href without a `Link`, or any intent-based router transition.

## Signals

Guards and route configs return signals, or throw the typed helpers:

- `redirect(to, { status })` — typed throw signaling a redirect.
- `notFound(message?)` — typed throw signaling a 404.
- `forbidden(message?)` — typed throw signaling a 403.
- `badRequest(message?)` — typed throw signaling a 400.
- `methodNotAllowed(method, allowed)` — typed throw signaling a 405.
- A guard may simply `return true`, `return false` (= forbidden), or return a signal value.

## Matching

- Specificity-aware: when more than one sibling can match a URL, the most specific wins (`literal > param > catch-all`). Definition order is the stable tiebreaker.
- `RouteMatch.signature` is a deterministic string keyed by `routeId | pathname | canonicalized query`. Identical logical matches always produce the same signature — useful as a memo key, navigation-cache key, or prefetch dedup key.
- `App.match(url)` is backed by an LRU (default capacity 256, override via `app({ matchCacheCapacity })`). Both hit and no-match results are cached. `App.clearMatchCache()` is exposed for dev / HMR.
- `app(...)` eagerly runs `validateManifest`, which catches duplicate route ids, duplicate patterns under the same ancestry, catch-all segments that aren't last, and catch-all segments inside group patterns. All issues are reported in a single throw.

## URL building

`hrefFor(app, routeId, params, query?, hash?)` reverses the matcher: it walks ancestor groups to collect the full query codec map, runs path params and query values through `codec.serialize`, and returns the URL the matcher would consume back. `urlFor(app, routeId, { params, query, hash })` is the same with a named-options shape.

## Boundaries

`renderBoundary(result, { boundary })` produces a React node for every signal kind:

- `notFound`, `forbidden`, `badRequest`, `methodNotAllowed` — each receives the matching signal as a prop, so a custom `NotFound` can show `signal.message` and a `MethodNotAllowed` can read `signal.method` / `signal.allowed`.
- `loading` — Suspense fallback for the route subtree.
- `error` — wraps the route tree in a React error boundary; the fallback receives `{ error, reset }`.

Inside the boundary subtree, `useRouteError()` returns `{ kind, signal }` for the active routing-level error so a shared error layout can style the page based on which signal fired, without prop-drilling.

## Client navigation

`flow-membrane/client` exports a small client surface that piggy-backs on `flow-cell` for navigation state:

- `Link` — anchor that delegates plain left-clicks to `navigate()`, leaves modifier/middle clicks alone, and supports four prefetch policies via `prefetch="none" | "intent" | "render" | "viewport"`. `"viewport"` uses `IntersectionObserver` and falls back to immediate preload when one isn't available.
- `navigate(target, options?)` — programmatic navigation.
- `useNavigation()` — the active `Navigation` handle.
- `useUrl()` — the current URL as a `flow-cell` value.
- `useRouteMatch()` — the matched route id, params, and stable signature.
- `useRouteError()` — the active `RouteError` inside a boundary subtree (`null` elsewhere).
- `useMetadata()` — the metadata resolved from the current route module's `membrane({ metadata })`.

Server guards are the source of truth for correctness. Client `beforeLeave` guards are only for UX — dirty-form prompts, optimistic blocks, etc.

```js
const nav = useNavigation();
useEffect(() => nav.beforeLeave(event => {
  if (form.dirty.get()) {
    return "You have unsaved changes.";
  }
  return true;
}), [nav]);
```

## Observability

```js
app({
  telemetry: {
    onDispatchStart: ({ url, method }) => span.start({ url, method }),
    onMatch: ({ match }) => span.tag("route.id", match.route.id),
    onDispatchEnd: ({ result, durationMs }) => span.end({ kind: result.kind, durationMs }),
  },
  routes: [...],
});
```

`onDispatchEnd` always fires, including no-match, signals, and unexpected throws. Hook exceptions are swallowed so a buggy reporter cannot break a request. `durationMs` uses `performance.now` when available.

`App.snapshot()` returns a structural fingerprint of the manifest (route kinds, ids, patterns, methods, guard/middleware ids, codec keys, group nesting). Dev hosts can compare snapshots across module reloads to decide whether to clear caches, restart navigation, or accept a hot update.

## Security headers

```js
import { securityHeaders } from "flow-membrane";

const headers = securityHeaders({
  csp: { "default-src": ["'self'"], "img-src": ["'self'", "data:"] },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  crossOriginOpenerPolicy: "same-origin",
});
```

Sensible defaults (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`) are applied unless you set the field to `"off"`. CSP, HSTS, COOP/COEP/CORP, and Permissions-Policy are opt-in. `buildCspHeader({ ... })` is exported separately if you only want the directive serializer.

## Server / Client / RSC split

- `flow-membrane` and `flow-membrane/server` — manifest builders, matcher, dispatcher, signals, codecs, navigation factory, telemetry, security headers, prefetch helpers. Safe in RSC.
- `flow-membrane/client` — `Link`, `navigate`, `useNavigation`, `useUrl`, `useRouteMatch`, `useRouteError`, `useMetadata`. Tagged `"use client"`.

## Status

FlowMembrane is experimental. The runtime is in place. PPR/prerender artifacts, chunk splitting, and HTTP wiring are intentionally framework concerns the manifest is designed to feed.
