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

  // result.kind === "render"
  return renderToResponse(result.render);
}
```

## Signals

Guards and route configs return signals, or throw the typed helpers:

- `redirect(to, { status })` — typed throw signaling a redirect.
- `notFound(message?)` — typed throw signaling a 404.
- `forbidden(message?)` — typed throw signaling a 403.
- A guard may simply `return true`, `return false` (= forbidden), or return a signal value.

## Client navigation

`flow-membrane/client` exports a small client surface that piggy-backs on `flow-cell` for navigation state:

- `Link` — `<a>` with intent-based prefetch using the manifest.
- `navigate(target)` — programmatic navigation.
- `useNavigation()` — the active `Navigation` handle.
- `useUrl()` — the current URL as a `flow-cell` value.
- `useRouteMatch()` — the matched route id and params.

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

## Server / Client / RSC split

- `flow-membrane` and `flow-membrane/server` — manifest builders, matcher, dispatcher, signals, codecs, navigation factory. Safe in RSC.
- `flow-membrane/client` — `Link`, `navigate`, `useNavigation`, `useUrl`, `useRouteMatch`. Tagged `"use client"`.

## Status

FlowMembrane is experimental. The runtime is in place. PPR/prerender artifacts, chunk splitting, and HTTP wiring are intentionally framework concerns the manifest is designed to feed.
