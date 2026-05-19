/* eslint-disable no-undef */

const React = require("react");
const ReactDOMServer = require("react-dom/server");

const {
  app,
  awaitGenes,
  badRequest,
  codecs,
  clearCookie,
  dispatch,
  forbidden,
  group,
  guard,
  isGenePending,
  lazy,
  matchRoute,
  membrane,
  middleware,
  notFound,
  parseCookieHeader,
  prerenderPlan,
  redirect,
  renderBoundary,
  renderMetaTags,
  renderResolved,
  route,
  serializeCookie,
  validatePrerenderConfig,
  isBadRequest,
  isRedirect,
  isNotFound,
  isForbidden,
  isAbortError,
  AbortError,
  createNavigation,
  hrefFor,
  previewMatch,
  urlFor,
  validateManifest,
  buildCspHeader,
  securityHeaders,
  Link,
  NavigationProvider,
} = require("./FlowMembrane");

function homeModule() {
  return lazy(async () => ({
    default: () => null,
  }));
}

function paramModule() {
  return lazy(async () => ({
    default: () => null,
    config: membrane({
      genes: ctx => ({ id: ctx.params.id }),
    }),
  }));
}

test("compiles literal and param paths", () => {
  const routes = [
    route("/", { id: "root", module: homeModule() }),
    route("/products/:id", { id: "product", module: paramModule() }),
    route("/files/*rest", { id: "files", module: homeModule() }),
  ];

  expect(matchRoute(routes, "/")?.route.id).toBe("root");
  const match = matchRoute(routes, "/products/123");
  expect(match?.route.id).toBe("product");
  expect(match?.params.id).toBe("123");

  const filesMatch = matchRoute(routes, "/files/a/b/c");
  expect(filesMatch?.route.id).toBe("files");
  expect(Array.isArray(filesMatch?.params.rest)).toBe(true);
  expect(filesMatch?.params.rest).toEqual(["a", "b", "c"]);
});

test("matcher returns null on no match", () => {
  const routes = [route("/", { id: "root", module: homeModule() })];
  expect(matchRoute(routes, "/missing")).toBeNull();
});

test("groups concatenate paths and accumulate guards", async () => {
  const routes = [
    group("/dashboard", {
      id: "dash",
      guard: () => true,
      routes: [
        route("/", { id: "home", module: homeModule() }),
        route("/settings", { id: "settings", module: homeModule() }),
      ],
    }),
  ];

  expect(matchRoute(routes, "/dashboard")?.route.id).toBe("home");
  const settings = matchRoute(routes, "/dashboard/settings");
  expect(settings?.route.id).toBe("settings");
  expect(settings?.ancestors.length).toBe(1);
  expect(settings?.ancestors[0].id).toBe("dash");
});

test("param codec parses int", () => {
  const routes = [
    route("/users/:id", {
      id: "user",
      params: { id: codecs.int() },
      module: homeModule(),
    }),
  ];

  const ok = matchRoute(routes, "/users/42");
  expect(ok?.params.id).toBe(42);

  const bad = matchRoute(routes, "/users/abc");
  expect(bad).toBeNull();
});

test("dispatch returns render result for a matching route", async () => {
  const myApp = app({
    routes: [
      route("/products/:id", {
        id: "product",
        module: paramModule(),
      }),
    ],
  });
  const result = await dispatch(myApp, "/products/abc");
  expect(result.kind).toBe("render");
  if (result.kind === "render") {
    expect(result.render.match.params.id).toBe("abc");
    expect(result.render.context.genes.id).toBe("abc");
  }
});

test("dispatch returns notFound for unknown urls", async () => {
  const myApp = app({
    routes: [route("/", { id: "root", module: homeModule() })],
  });
  const result = await dispatch(myApp, "/missing");
  expect(result.kind).toBe("notFound");
});

test("guard signals propagate", async () => {
  const myApp = app({
    routes: [
      route("/secret", {
        id: "secret",
        guard: () => {
          forbidden("nope");
        },
        module: homeModule(),
      }),
    ],
  });
  const result = await dispatch(myApp, "/secret");
  expect(result.kind).toBe("forbidden");
});

test("redirect signal sets to/status", async () => {
  const myApp = app({
    routes: [
      route("/old", {
        id: "old",
        guard: () => {
          redirect("/new", { status: 308 });
        },
        module: homeModule(),
      }),
    ],
  });
  const result = await dispatch(myApp, "/old");
  expect(result.kind).toBe("redirect");
  if (result.kind === "redirect") {
    expect(result.signal.to).toBe("/new");
    expect(result.signal.status).toBe(308);
  }
});

test("middleware runs in order", async () => {
  const order = [];
  const mw1 = middleware(async (ctx, next) => {
    order.push("mw1:before");
    ctx.state.a = "1";
    await next();
    order.push("mw1:after");
  });
  const mw2 = middleware(async (ctx, next) => {
    order.push("mw2:before");
    await next();
    order.push("mw2:after");
  });
  const myApp = app({
    middleware: [mw1, mw2],
    routes: [route("/", { id: "root", module: homeModule() })],
  });
  await dispatch(myApp, "/");
  expect(order).toEqual([
    "mw1:before",
    "mw2:before",
    "mw2:after",
    "mw1:after",
  ]);
});

test("returning false from a guard becomes forbidden", async () => {
  const myApp = app({
    routes: [
      route("/secret", {
        id: "secret",
        guard: () => false,
        module: homeModule(),
      }),
    ],
  });
  const result = await dispatch(myApp, "/secret");
  expect(result.kind).toBe("forbidden");
});

test("signal predicates classify values", () => {
  expect(isRedirect({ kind: "redirect", to: "/x", status: 307 })).toBe(true);
  expect(isNotFound({ kind: "notFound" })).toBe(true);
  expect(isForbidden({ kind: "forbidden" })).toBe(true);
  expect(isRedirect({ kind: "notFound" })).toBe(false);
});

test("navigation saves and restores scroll on back-style notifyPop", async () => {
  const scrollCalls = [];
  const stash = globalThis.scrollTo;
  globalThis.scrollTo = (x, y) => { scrollCalls.push([x, y]); };
  try {
    const nav = createNavigation({
      initial: new URL("/a", "http://test.local"),
    });
    nav.saveScroll("/a", { x: 0, y: 0 });
    nav.saveScroll("/b", { x: 0, y: 0 });
    Object.defineProperty(globalThis, "scrollY", { value: 250, configurable: true });
    Object.defineProperty(globalThis, "scrollX", { value: 0, configurable: true });
    await nav.navigate("/b");
    Object.defineProperty(globalThis, "scrollY", { value: 100, configurable: true });
    await nav.notifyPop("/a");
    expect(nav.current.get().pathname).toBe("/a");
    const lastCall = scrollCalls[scrollCalls.length - 1];
    expect(lastCall[0]).toBe(0);
    expect(lastCall[1]).toBe(250);
  } finally {
    globalThis.scrollTo = stash;
  }
});

test("navigation scroll: \"top\" scrolls to (0, 0) regardless of saved", async () => {
  const scrollCalls = [];
  const stash = globalThis.scrollTo;
  globalThis.scrollTo = (x, y) => { scrollCalls.push([x, y]); };
  try {
    const nav = createNavigation({
      initial: new URL("/a", "http://test.local"),
    });
    nav.saveScroll("/b", { x: 99, y: 99 });
    await nav.navigate("/b", { scroll: "top" });
    expect(scrollCalls[scrollCalls.length - 1]).toEqual([0, 0]);
  } finally {
    globalThis.scrollTo = stash;
  }
});

test("navigation scroll: \"preserve\" does not call scrollTo", async () => {
  const scrollCalls = [];
  const stash = globalThis.scrollTo;
  globalThis.scrollTo = (x, y) => { scrollCalls.push([x, y]); };
  try {
    const nav = createNavigation({
      initial: new URL("/a", "http://test.local"),
    });
    await nav.navigate("/b", { scroll: "preserve" });
    expect(scrollCalls.length).toBe(0);
  } finally {
    globalThis.scrollTo = stash;
  }
});

test("navigation registers and runs beforeLeave guard", async () => {
  const nav = createNavigation({
    initial: new URL("/", "http://test.local"),
  });
  let allowed = true;
  nav.beforeLeave(event => {
    if (!allowed) {
      event.cancel();
      return false;
    }
    return true;
  });
  await nav.navigate("/a");
  expect(nav.current.get().pathname).toBe("/a");
  allowed = false;
  await nav.navigate("/b");
  expect(nav.current.get().pathname).toBe("/a");
});

test("hrefFor builds path from route id and params", () => {
  const application = app({
    routes: [
      route("/products/:id", { id: "product.show", module: homeModule() }),
    ],
  });
  expect(hrefFor(application, "product.show", { id: "42" })).toBe("/products/42");
});

test("hrefFor builds query string and hash", () => {
  const application = app({
    routes: [
      route("/products/:id", { id: "product.show", module: homeModule() }),
    ],
  });
  const href = hrefFor(
    application,
    "product.show",
    { id: "42" },
    { tag: "new", n: 3 },
    "details",
  );
  expect(href).toContain("/products/42?");
  expect(href).toContain("tag=new");
  expect(href).toContain("n=3");
  expect(href).toContain("#details");
});

test("hrefFor encodes path params", () => {
  const application = app({
    routes: [
      route("/u/:name", { id: "user", module: homeModule() }),
    ],
  });
  expect(hrefFor(application, "user", { name: "a/b c" })).toBe("/u/a%2Fb%20c");
});

test("hrefFor expands catch-all params", () => {
  const application = app({
    routes: [
      route("/files/*rest", { id: "files", module: homeModule() }),
    ],
  });
  expect(hrefFor(application, "files", { rest: ["a", "b", "c"] })).toBe(
    "/files/a/b/c",
  );
});

test("hrefFor throws on unknown route id", () => {
  const application = app({
    routes: [route("/", { id: "root", module: homeModule() })],
  });
  expect(() => hrefFor(application, "missing", {})).toThrow(
    "Unknown route id: missing",
  );
});

test("hrefFor throws on missing required path param", () => {
  const application = app({
    routes: [
      route("/products/:id", { id: "product", module: homeModule() }),
    ],
  });
  expect(() => hrefFor(application, "product", {})).toThrow(
    /Missing param "id"/,
  );
});

test("hrefFor applies query codecs from the route", () => {
  const application = app({
    routes: [
      route("/q", {
        id: "q",
        query: { active: codecs.query.bool() },
        module: homeModule(),
      }),
    ],
  });
  expect(hrefFor(application, "q", {}, { active: true })).toBe("/q?active=1");
  expect(hrefFor(application, "q", {}, { active: false })).toBe("/q?active=0");
});

test("hrefFor inherits query codecs from group ancestors", () => {
  const application = app({
    routes: [
      group("/admin", {
        id: "admin",
        query: { tab: codecs.query.enum(["users", "billing"]) },
        routes: [
          route("/", { id: "admin.home", module: homeModule() }),
        ],
      }),
    ],
  });
  expect(hrefFor(application, "admin.home", {}, { tab: "users" })).toBe(
    "/admin?tab=users",
  );
});

test("urlFor wraps hrefFor with named options", () => {
  const application = app({
    routes: [
      route("/products/:id", { id: "product", module: homeModule() }),
    ],
  });
  expect(urlFor(application, "product", { params: { id: "9" } })).toBe("/products/9");
  expect(
    urlFor(application, "product", {
      params: { id: "9" },
      query: { ref: "feed" },
      hash: "top",
    }),
  ).toBe("/products/9?ref=feed#top");
});

test("urlFor works for parameterless routes without options", () => {
  const application = app({
    routes: [route("/", { id: "root", module: homeModule() })],
  });
  expect(urlFor(application, "root")).toBe("/");
});

test("validateManifest rejects duplicate route ids", () => {
  expect(() =>
    app({
      routes: [
        route("/a", { id: "x", module: homeModule() }),
        route("/b", { id: "x", module: homeModule() }),
      ],
    }),
  ).toThrow(/Duplicate route id: "x"/);
});

test("validateManifest rejects duplicate route patterns", () => {
  expect(() =>
    app({
      routes: [
        route("/products/:id", { id: "a", module: homeModule() }),
        route("/products/:slug", { id: "b", module: homeModule() }),
      ],
    }),
  ).toThrow(/Duplicate route pattern/);
});

test("validateManifest rejects catch-all not at the end", () => {
  expect(() => app({
    routes: [
      route("/files/*rest/extra", { id: "files", module: homeModule() }),
    ],
  })).toThrow(/Catch-all segment must be the last segment/);
});

test("validateManifest rejects catch-all on group", () => {
  expect(() =>
    app({
      routes: [
        group("/files/*rest", {
          id: "files",
          routes: [route("/", { id: "files.home", module: homeModule() })],
        }),
      ],
    }),
  ).toThrow(/Group pattern cannot contain a catch-all segment/);
});

test("validateManifest detects duplicate id deep inside a group", () => {
  expect(() =>
    app({
      routes: [
        route("/a", { id: "shared", module: homeModule() }),
        group("/admin", {
          id: "admin",
          routes: [
            route("/b", { id: "shared", module: homeModule() }),
          ],
        }),
      ],
    }),
  ).toThrow(/Duplicate route id: "shared"/);
});

test("validateManifest accepts the same pattern under different groups", () => {
  const application = app({
    routes: [
      group("/a", {
        id: "a",
        routes: [route("/x", { id: "a.x", module: homeModule() })],
      }),
      group("/b", {
        id: "b",
        routes: [route("/x", { id: "b.x", module: homeModule() })],
      }),
    ],
  });
  expect(application.routeById("a.x")?.id).toBe("a.x");
  expect(application.routeById("b.x")?.id).toBe("b.x");
});

test("validateManifest passes for a normal manifest", () => {
  validateManifest([
    route("/", { id: "home", module: homeModule() }),
    route("/products/:id", { id: "product", module: homeModule() }),
    group("/admin", {
      id: "admin",
      routes: [
        route("/", { id: "admin.home", module: homeModule() }),
        route("/users", { id: "admin.users", module: homeModule() }),
      ],
    }),
  ]);
});

test("app.match returns the same RouteMatch instance for the same url (cache hit)", () => {
  const application = app({
    routes: [route("/p/:id", { id: "p", module: homeModule() })],
  });
  const a = application.match("/p/1");
  const b = application.match("/p/1");
  expect(a).toBe(b);
});

test("app.match returns distinct matches for distinct urls", () => {
  const application = app({
    routes: [route("/p/:id", { id: "p", module: homeModule() })],
  });
  const a = application.match("/p/1");
  const b = application.match("/p/2");
  expect(a !== b).toBe(true);
  expect(a?.params.id).toBe("1");
  expect(b?.params.id).toBe("2");
});

test("app.match caches null results for unknown urls", () => {
  const application = app({
    routes: [route("/", { id: "root", module: homeModule() })],
  });
  expect(application.match("/missing")).toBeNull();
  expect(application.match("/missing")).toBeNull();
});

test("app.match LRU evicts the least-recently-used entry past capacity", () => {
  const application = app({
    matchCacheCapacity: 2,
    routes: [route("/p/:id", { id: "p", module: homeModule() })],
  });
  const a1 = application.match("/p/a");
  const b1 = application.match("/p/b");
  expect(application.match("/p/a")).toBe(a1);
  application.match("/p/c");
  expect(application.match("/p/a")).toBe(a1);
  const b2 = application.match("/p/b");
  expect(b2 !== b1).toBe(true);
});

test("app.clearMatchCache invalidates cached matches", () => {
  const application = app({
    routes: [route("/p/:id", { id: "p", module: homeModule() })],
  });
  const a = application.match("/p/1");
  application.clearMatchCache();
  const b = application.match("/p/1");
  expect(a !== b).toBe(true);
});

test("telemetry hooks fire for a successful dispatch", async () => {
  const events = [];
  const application = app({
    telemetry: {
      onDispatchStart: e => events.push({ kind: "start", method: e.method, href: e.url.pathname }),
      onMatch: e => events.push({ kind: "match", routeId: e.match.route.id }),
      onDispatchEnd: e => events.push({ kind: "end", result: e.result.kind, durationOk: typeof e.durationMs === "number" }),
    },
    routes: [route("/p/:id", { id: "p", module: paramModule() })],
  });
  const result = await dispatch(application, "/p/42");
  expect(result.kind).toBe("render");
  expect(events.length).toBe(3);
  expect(events[0].kind).toBe("start");
  expect(events[0].method).toBe("GET");
  expect(events[1].kind).toBe("match");
  expect(events[1].routeId).toBe("p");
  expect(events[2].kind).toBe("end");
  expect(events[2].result).toBe("render");
  expect(events[2].durationOk).toBe(true);
});

test("telemetry onDispatchEnd fires for notFound (no match)", async () => {
  const events = [];
  const application = app({
    telemetry: {
      onMatch: () => events.push("match"),
      onDispatchEnd: e => events.push(`end:${e.result.kind}`),
    },
    routes: [route("/", { id: "root", module: homeModule() })],
  });
  await dispatch(application, "/nope");
  expect(events).toEqual(["end:notFound"]);
});

test("telemetry hook exceptions do not break dispatch", async () => {
  const application = app({
    telemetry: {
      onDispatchStart: () => { throw new Error("boom"); },
      onMatch: () => { throw new Error("boom"); },
      onDispatchEnd: () => { throw new Error("boom"); },
    },
    routes: [route("/", { id: "root", module: homeModule() })],
  });
  const result = await dispatch(application, "/");
  expect(result.kind).toBe("render");
});

test("Link renders an anchor with the resolved href", () => {
  const node = React.createElement(Link, { to: "/foo" }, "go");
  const html = ReactDOMServer.renderToString(node);
  expect(html.includes("href=\"/foo\"")).toBe(true);
  expect(html.includes(">go</a>")).toBe(true);
});

test("Link serializes a structured target into href", () => {
  const node = React.createElement(
    Link,
    { to: { to: "/p", query: { q: "x" }, hash: "h" } },
    "go",
  );
  const html = ReactDOMServer.renderToString(node);
  expect(html.includes("href=\"/p?q=x#h\"")).toBe(true);
});

test("Link does not call prefetch on the server", () => {
  let calls = 0;
  const moduleLoader = lazy(async () => {
    calls += 1;
    return { default: () => null };
  });
  const application = app({
    routes: [route("/p/:id", { id: "p", module: moduleLoader })],
  });
  const node = React.createElement(
    NavigationProvider,
    { app: application },
    React.createElement(Link, { to: "/p/1", prefetch: "render" }, "go"),
  );
  ReactDOMServer.renderToString(node);
  expect(calls).toBe(0);
});

test("securityHeaders applies sensible defaults", () => {
  const headers = securityHeaders();
  expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  expect(headers["X-Frame-Options"]).toBe("DENY");
  expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["Strict-Transport-Security"]).toBe(undefined);
  expect(headers["Content-Security-Policy"]).toBe(undefined);
});

test('securityHeaders honors "off" to remove defaults', () => {
  const headers = securityHeaders({
    contentTypeOptions: "off",
    frameOptions: "off",
    referrerPolicy: "off",
  });
  expect(headers["X-Content-Type-Options"]).toBe(undefined);
  expect(headers["X-Frame-Options"]).toBe(undefined);
  expect(headers["Referrer-Policy"]).toBe(undefined);
});

test("securityHeaders emits HSTS from options", () => {
  const headers = securityHeaders({
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  });
  expect(headers["Strict-Transport-Security"]).toBe(
    "max-age=31536000; includeSubDomains; preload",
  );
});

test("securityHeaders accepts a raw HSTS string", () => {
  const headers = securityHeaders({ hsts: "max-age=600" });
  expect(headers["Strict-Transport-Security"]).toBe("max-age=600");
});

test("securityHeaders rejects HSTS maxAge that is not non-negative", () => {
  expect(() => securityHeaders({ hsts: { maxAge: -1 } })).toThrow(
    /HSTS maxAge must be a non-negative finite number/,
  );
});

test("buildCspHeader serializes a directive map", () => {
  const csp = buildCspHeader({
    "default-src": ["'self'"],
    "img-src": ["'self'", "data:", "https://cdn.example.com"],
    "upgrade-insecure-requests": [],
  });
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("img-src 'self' data: https://cdn.example.com");
  expect(csp).toContain("upgrade-insecure-requests");
  expect(csp.split("; ").length).toBe(3);
});

test("securityHeaders accepts either a CSP string or directive map", () => {
  const fromString = securityHeaders({ csp: "default-src 'self'" });
  const fromMap = securityHeaders({ csp: { "default-src": ["'self'"] } });
  expect(fromString["Content-Security-Policy"]).toBe("default-src 'self'");
  expect(fromMap["Content-Security-Policy"]).toBe("default-src 'self'");
});

test("securityHeaders separates report-only CSP", () => {
  const headers = securityHeaders({
    cspReportOnly: { "default-src": ["'self'"] },
  });
  expect(headers["Content-Security-Policy"]).toBe(undefined);
  expect(headers["Content-Security-Policy-Report-Only"]).toBe(
    "default-src 'self'",
  );
});

test("securityHeaders emits cross-origin isolation triples on request", () => {
  const headers = securityHeaders({
    crossOriginOpenerPolicy: "same-origin",
    crossOriginEmbedderPolicy: "require-corp",
    crossOriginResourcePolicy: "same-origin",
    permissionsPolicy: "camera=()",
  });
  expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  expect(headers["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
  expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  expect(headers["Permissions-Policy"]).toBe("camera=()");
});

test("telemetry reports the final result kind for redirects", async () => {
  const observed = [];
  const application = app({
    telemetry: {
      onDispatchEnd: e => observed.push(e.result.kind),
    },
    routes: [
      route("/old", {
        id: "old",
        guard: () => { redirect("/new", { status: 308 }); },
        module: homeModule(),
      }),
    ],
  });
  await dispatch(application, "/old");
  expect(observed).toEqual(["redirect"]);
});

test("previewMatch resolves a target into route info", () => {
  const myApp = app({
    routes: [
      route("/p/:id", { id: "p", module: homeModule() }),
    ],
  });
  const preview = previewMatch(myApp, "/p/9");
  expect(preview?.routeId).toBe("p");
  expect(preview?.params.id).toBe("9");
  expect(typeof preview?.signature).toBe("string");
  expect(preview?.signature).toContain("p|/p/9");
});

test("matchRoute signature is stable for the same url", () => {
  const routes = [
    route("/products/:id", { id: "product", module: homeModule() }),
  ];
  const a = matchRoute(routes, "/products/42?tag=new&sort=asc");
  const b = matchRoute(routes, "/products/42?sort=asc&tag=new");
  expect(a?.signature).toBe(b?.signature);
});

test("matchRoute signature differs by routeId, pathname, and query", () => {
  const routes = [
    route("/a/:id", { id: "a", module: homeModule() }),
    route("/b/:id", { id: "b", module: homeModule() }),
  ];
  const a1 = matchRoute(routes, "/a/1");
  const a2 = matchRoute(routes, "/a/2");
  const b1 = matchRoute(routes, "/b/1");
  const a1q = matchRoute(routes, "/a/1?x=1");
  expect(a1?.signature).not.toBe(a2?.signature);
  expect(a1?.signature).not.toBe(b1?.signature);
  expect(a1?.signature).not.toBe(a1q?.signature);
});

test("matchRoute signature sorts repeated query values", () => {
  const routes = [route("/q", { id: "q", module: homeModule() })];
  const a = matchRoute(routes, "/q?tag=b&tag=a");
  const b = matchRoute(routes, "/q?tag=a&tag=b");
  expect(a?.signature).toBe(b?.signature);
});

test("app.paths enumerates patterns", () => {
  const myApp = app({
    routes: [
      route("/", { id: "root", module: homeModule() }),
      group("/admin", {
        id: "admin",
        routes: [
          route("/users", { id: "users", module: homeModule() }),
        ],
      }),
    ],
  });
  const paths = myApp.paths();
  expect(paths).toContain("/");
  expect(paths.some(p => p.endsWith("/users"))).toBe(true);
});

test("dispatch reports notFound when matched then notFound() in genes", async () => {
  const myApp = app({
    routes: [
      route("/p/:id", {
        id: "p",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            genes: () => {
              notFound("missing");
            },
          }),
        })),
      }),
    ],
  });
  const result = await dispatch(myApp, "/p/1");
  expect(result.kind).toBe("notFound");
});

test("lazy preloads modules and reads cached value", async () => {
  let loadCount = 0;
  const mod = lazy(async () => {
    loadCount += 1;
    return { default: () => null };
  });
  await mod.preload();
  await mod.load();
  expect(loadCount).toBe(1);
  expect(typeof mod.read).toBe("function");
});

test("lazy caches rejection and does not auto-retry until invalidate()", async () => {
  let attempts = 0;
  const mod = lazy(async () => {
    attempts += 1;
    throw new Error("boom");
  });
  let err1 = null;
  try { await mod.load(); } catch (e) { err1 = e; }
  let err2 = null;
  try { await mod.load(); } catch (e) { err2 = e; }
  expect(attempts).toBe(1);
  expect(err1).not.toBe(null);
  expect(err1).toBe(err2);

  mod.invalidate();
  let err3 = null;
  try { await mod.load(); } catch (e) { err3 = e; }
  expect(attempts).toBe(2);
  expect(err3 instanceof Error).toBe(true);
});

test("lazy read() throws cached rejection synchronously", async () => {
  const mod = lazy(async () => {
    throw new Error("nope");
  });
  try { await mod.load(); } catch (_e) {}
  let caught = null;
  try { mod.read(); } catch (e) { caught = e; }
  expect(caught).not.toBe(null);
  expect(caught instanceof Error).toBe(true);
});

test("dispatch surfaces module load failure as a thrown error", async () => {
  const myApp = app({
    routes: [
      route("/bad", {
        id: "bad",
        module: lazy(async () => {
          throw new Error("module exploded");
        }),
      }),
    ],
  });
  let caught = null;
  try {
    await dispatch(myApp, "/bad");
  } catch (e) {
    caught = e;
  }
  expect(caught).not.toBe(null);
  expect(caught instanceof Error).toBe(true);
});

test("dispatch rejects with AbortError when signal pre-aborted", async () => {
  const myApp = app({
    routes: [route("/", { id: "root", module: homeModule() })],
  });
  const controller = new AbortController();
  controller.abort(new Error("user cancelled"));
  let caught = null;
  try {
    await dispatch(myApp, "/", { signal: controller.signal });
  } catch (err) {
    caught = err;
  }
  expect(caught).not.toBe(null);
  expect(isAbortError(caught)).toBe(true);
  expect(caught instanceof AbortError).toBe(true);
});

test("dispatch surfaces signal in middleware/guard/route contexts", async () => {
  let mwSignal = null;
  let guardSignal = null;
  const captureMw = middleware(async (ctx, next) => {
    mwSignal = ctx.signal;
    return next();
  });
  const myApp = app({
    middleware: [captureMw],
    routes: [
      route("/x", {
        id: "x",
        guard: ctx => {
          guardSignal = ctx.signal;
          return true;
        },
        module: homeModule(),
      }),
    ],
  });
  const controller = new AbortController();
  const result = await dispatch(myApp, "/x", { signal: controller.signal });
  expect(result.kind).toBe("render");
  expect(mwSignal).toBe(controller.signal);
  expect(guardSignal).toBe(controller.signal);
  if (result.kind === "render") {
    expect(result.render.context.signal).toBe(controller.signal);
  }
});

test("dispatch aborts after middleware when signal fires mid-flight", async () => {
  const controller = new AbortController();
  let guardEntered = false;
  const slowMw = middleware(async (ctx, next) => {
    controller.abort(new Error("timeout"));
    return next();
  });
  const myApp = app({
    middleware: [slowMw],
    routes: [
      route("/x", {
        id: "x",
        guard: () => {
          guardEntered = true;
          return true;
        },
        module: homeModule(),
      }),
    ],
  });
  let caught = null;
  try {
    await dispatch(myApp, "/x", { signal: controller.signal });
  } catch (err) {
    caught = err;
  }
  expect(isAbortError(caught)).toBe(true);
  expect(guardEntered).toBe(false);
});

test("query codecs decode primitives into context.query", async () => {
  const myApp = app({
    routes: [
      route("/search", {
        id: "search",
        query: {
          page: codecs.query.int({ default: 1 }),
          sort: codecs.query.string({ default: "name" }),
          archived: codecs.query.bool({ default: false }),
        },
        module: homeModule(),
      }),
    ],
  });
  const result = await dispatch(myApp, "/search?page=42&archived=true");
  expect(result.kind).toBe("render");
  if (result.kind === "render") {
    expect(result.render.context.query.page).toBe(42);
    expect(result.render.context.query.sort).toBe("name");
    expect(result.render.context.query.archived).toBe(true);
  }
});

test("query codec failure yields badRequest", async () => {
  const myApp = app({
    routes: [
      route("/search", {
        id: "search",
        query: { page: codecs.query.int() },
        module: homeModule(),
      }),
    ],
  });
  const result = await dispatch(myApp, "/search?page=NaN");
  expect(result.kind).toBe("badRequest");
});

test("query array codec aggregates repeated keys", async () => {
  const myApp = app({
    routes: [
      route("/filter", {
        id: "filter",
        query: { tag: codecs.query.array(codecs.query.string()) },
        module: homeModule(),
      }),
    ],
  });
  const result = await dispatch(myApp, "/filter?tag=a&tag=b&tag=c");
  expect(result.kind).toBe("render");
  if (result.kind === "render") {
    expect(result.render.context.query.tag).toEqual(["a", "b", "c"]);
  }
});

test("query enum codec rejects out-of-range values", async () => {
  const myApp = app({
    routes: [
      route("/list", {
        id: "list",
        query: { order: codecs.query.enum(["asc", "desc"]) },
        module: homeModule(),
      }),
    ],
  });
  const ok = await dispatch(myApp, "/list?order=asc");
  expect(ok.kind).toBe("render");
  const bad = await dispatch(myApp, "/list?order=sideways");
  expect(bad.kind).toBe("badRequest");
});

test("badRequest signal propagates from guard", async () => {
  const myApp = app({
    routes: [
      route("/x", {
        id: "x",
        guard: () => {
          badRequest("bad input");
        },
        module: homeModule(),
      }),
    ],
  });
  const result = await dispatch(myApp, "/x");
  expect(result.kind).toBe("badRequest");
  expect(isBadRequest(result.signal)).toBe(true);
});

test("group-level query codec applies to child route", async () => {
  const myApp = app({
    routes: [
      group("/admin", {
        id: "admin",
        query: { tab: codecs.query.string({ default: "overview" }) },
        routes: [
          route("/users", { id: "admin.users", module: homeModule() }),
        ],
      }),
    ],
  });
  const result = await dispatch(myApp, "/admin/users");
  expect(result.kind).toBe("render");
  if (result.kind === "render") {
    expect(result.render.context.query.tab).toBe("overview");
  }
});

test("method whitelist returns methodNotAllowed for disallowed method", async () => {
  const myApp = app({
    routes: [
      route("/api", {
        id: "api",
        methods: ["GET", "POST"],
        module: homeModule(),
      }),
    ],
  });
  const ok = await dispatch(myApp, "/api", {
    request: { url: "/api", method: "POST", headers: {} },
  });
  expect(ok.kind).toBe("render");
  const bad = await dispatch(myApp, "/api", {
    request: { url: "/api", method: "DELETE", headers: {} },
  });
  expect(bad.kind).toBe("methodNotAllowed");
  if (bad.kind === "methodNotAllowed") {
    expect(bad.signal.method).toBe("DELETE");
    expect(bad.signal.allowed).toEqual(["GET", "POST"]);
  }
});

test("group method whitelist intersects with route whitelist", async () => {
  const myApp = app({
    routes: [
      group("/api", {
        id: "api",
        methods: ["GET", "POST"],
        routes: [
          route("/items", {
            id: "items",
            methods: ["POST", "DELETE"],
            module: homeModule(),
          }),
        ],
      }),
    ],
  });
  const ok = await dispatch(myApp, "/api/items", {
    request: { url: "/api/items", method: "POST", headers: {} },
  });
  expect(ok.kind).toBe("render");
  const bad = await dispatch(myApp, "/api/items", {
    request: { url: "/api/items", method: "DELETE", headers: {} },
  });
  expect(bad.kind).toBe("methodNotAllowed");
});

test("guard and middleware see normalized method", async () => {
  let mwMethod = null;
  let guardMethod = null;
  const captureMw = middleware(async (ctx, next) => {
    mwMethod = ctx.method;
    return next();
  });
  const myApp = app({
    middleware: [captureMw],
    routes: [
      route("/x", {
        id: "x",
        guard: ctx => {
          guardMethod = ctx.method;
          return true;
        },
        module: homeModule(),
      }),
    ],
  });
  await dispatch(myApp, "/x", {
    request: { url: "/x", method: "post", headers: {} },
  });
  expect(mwMethod).toBe("POST");
  expect(guardMethod).toBe("POST");
});

test("method-specific action runs for matching method and surfaces actionResult", async () => {
  const calls = [];
  const myApp = app({
    routes: [
      route("/contact", {
        id: "contact",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            actions: {
              POST: async ctx => {
                calls.push(["POST", ctx.method]);
                return { ok: true };
              },
            },
          }),
        })),
      }),
    ],
  });
  const result = await dispatch(myApp, "/contact", {
    request: { url: "/contact", method: "POST", headers: {} },
  });
  expect(result.kind).toBe("render");
  if (result.kind === "render") {
    expect(result.render.context.actionResult).toEqual({ ok: true });
    expect(result.render.context.method).toBe("POST");
  }
  expect(calls).toEqual([["POST", "POST"]]);
});

test("action throwing redirect short-circuits to redirect result", async () => {
  const myApp = app({
    routes: [
      route("/contact", {
        id: "contact",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            actions: {
              POST: async () => {
                redirect("/thanks");
              },
            },
          }),
        })),
      }),
    ],
  });
  const result = await dispatch(myApp, "/contact", {
    request: { url: "/contact", method: "POST", headers: {} },
  });
  expect(result.kind).toBe("redirect");
  if (result.kind === "redirect") {
    expect(result.signal.to).toBe("/thanks");
  }
});

test("generic action handler runs for any non-GET/HEAD method", async () => {
  const calls = [];
  const myApp = app({
    routes: [
      route("/x", {
        id: "x",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            action: async ctx => {
              calls.push(ctx.method);
              return ctx.method;
            },
          }),
        })),
      }),
    ],
  });
  await dispatch(myApp, "/x", { request: { url: "/x", method: "GET", headers: {} } });
  await dispatch(myApp, "/x", { request: { url: "/x", method: "PUT", headers: {} } });
  await dispatch(myApp, "/x", { request: { url: "/x", method: "DELETE", headers: {} } });
  expect(calls).toEqual(["PUT", "DELETE"]);
});

test("blockingGuard is reported on failing dispatch result", async () => {
  const myApp = app({
    routes: [
      group("/admin", {
        id: "admin",
        guard: guard(({ session }) => session.user != null, "auth"),
        routes: [
          route("/secret", {
            id: "admin.secret",
            guard: guard(() => false, "perm"),
            module: homeModule(),
          }),
        ],
      }),
    ],
  });

  const noUser = await dispatch(myApp, "/admin/secret");
  expect(noUser.kind).toBe("forbidden");
  if (noUser.kind === "forbidden") {
    expect(noUser.blockingGuard).toBe("auth");
  }

  const withUser = await dispatch(myApp, "/admin/secret", {
    session: { user: { id: "1" } },
  });
  expect(withUser.kind).toBe("forbidden");
  if (withUser.kind === "forbidden") {
    expect(withUser.blockingGuard).toBe("perm");
  }
});

test("appliedGuards reflects guards that passed before the current one", async () => {
  const seen = [];
  const myApp = app({
    routes: [
      group("/x", {
        id: "x",
        guard: guard(() => true, "first"),
        routes: [
          route("/y", {
            id: "x.y",
            guard: guard(ctx => {
              seen.push(Array.from(ctx.appliedGuards));
              return true;
            }, "second"),
            module: homeModule(),
          }),
        ],
      }),
    ],
  });
  await dispatch(myApp, "/x/y");
  expect(seen).toEqual([["first"]]);
});

test("membrane config guard reports blockingGuard with :config suffix", async () => {
  const myApp = app({
    routes: [
      route("/x", {
        id: "x",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            guard: () => false,
          }),
        })),
      }),
    ],
  });
  const result = await dispatch(myApp, "/x");
  expect(result.kind).toBe("forbidden");
  if (result.kind === "forbidden") {
    expect(result.blockingGuard).toBe("x:config");
  }
});

test("serializeCookie produces secure attribute string with sensible defaults", () => {
  const cookie = serializeCookie("session", "abc123", {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    maxAge: 3600,
  });
  expect(cookie.startsWith("session=abc123")).toBe(true);
  expect(cookie.includes("HttpOnly")).toBe(true);
  expect(cookie.includes("Secure")).toBe(true);
  expect(cookie.includes("SameSite=Strict")).toBe(true);
  expect(cookie.includes("Max-Age=3600")).toBe(true);
  expect(cookie.includes("Path=/")).toBe(true);
});

test("serializeCookie defaults SameSite=Lax and adds Secure for SameSite=None", () => {
  const lax = serializeCookie("k", "v");
  expect(lax.includes("SameSite=Lax")).toBe(true);
  const none = serializeCookie("k", "v", { sameSite: "None" });
  expect(none.includes("Secure")).toBe(true);
  expect(none.includes("SameSite=None")).toBe(true);
});

test("clearCookie issues expired cookie", () => {
  const cookie = clearCookie("session");
  expect(cookie.includes("Max-Age=0")).toBe(true);
  expect(cookie.includes("Expires=Thu, 01 Jan 1970")).toBe(true);
});

test("parseCookieHeader handles missing and malformed entries", () => {
  expect(parseCookieHeader(null)).toEqual({});
  expect(parseCookieHeader("")).toEqual({});
  expect(parseCookieHeader("a=1; b=2"))
    .toEqual({ a: "1", b: "2" });
  expect(parseCookieHeader("standalone")).toEqual({ standalone: "" });
});

test("redirect signal carries setCookies through dispatch", async () => {
  const sessionCookie = serializeCookie("session", "tok", {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
  });
  const myApp = app({
    routes: [
      route("/login", {
        id: "login",
        guard: () => {
          redirect("/dashboard", { setCookies: [sessionCookie] });
        },
        module: homeModule(),
      }),
    ],
  });
  const result = await dispatch(myApp, "/login");
  expect(result.kind).toBe("redirect");
  if (result.kind === "redirect") {
    expect(result.signal.to).toBe("/dashboard");
    expect(Array.isArray(result.signal.setCookies)).toBe(true);
    expect(result.signal.setCookies?.length).toBe(1);
    expect(result.signal.setCookies?.[0]).toBe(sessionCookie);
  }
});

test("dispatch resolves function metadata against route context", async () => {
  const myApp = app({
    routes: [
      route("/p/:id", {
        id: "product",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            metadata: ctx => ({
              title: `Product ${ctx.params.id}`,
              description: "A great product",
            }),
          }),
        })),
      }),
    ],
  });
  const result = await dispatch(myApp, "/p/42");
  expect(result.kind).toBe("render");
  if (result.kind === "render") {
    expect(result.render.metadata.title).toBe("Product 42");
    expect(result.render.metadata.description).toBe("A great product");
  }
});

test("dispatch passes through static metadata", async () => {
  const myApp = app({
    routes: [
      route("/", {
        id: "home",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            metadata: { title: "Home" },
          }),
        })),
      }),
    ],
  });
  const result = await dispatch(myApp, "/");
  if (result.kind === "render") {
    expect(result.render.metadata.title).toBe("Home");
  }
});

test("renderMetaTags emits title, meta, link, og, twitter tags", () => {
  const tags = renderMetaTags({
    title: "Hi",
    description: "desc",
    canonical: "https://example.com/x",
    robots: "noindex",
    og: { type: "article", image: "https://example.com/img.png" },
    twitter: { card: "summary" },
    meta: [{ name: "theme-color", content: "#fff" }],
    link: [{ rel: "icon", href: "/icon.png" }],
  });
  const titles = tags.filter(t => t.tag === "title");
  expect(titles.length).toBe(1);
  expect(titles[0].text).toBe("Hi");
  const metas = tags.filter(t => t.tag === "meta");
  expect(metas.some(t => t.attrs.name === "description" && t.attrs.content === "desc")).toBe(true);
  expect(metas.some(t => t.attrs.property === "og:title")).toBe(true);
  expect(metas.some(t => t.attrs.property === "og:image")).toBe(true);
  expect(metas.some(t => t.attrs.name === "twitter:card")).toBe(true);
  expect(metas.some(t => t.attrs.name === "theme-color")).toBe(true);
  expect(metas.some(t => t.attrs.name === "robots" && t.attrs.content === "noindex")).toBe(true);
  const links = tags.filter(t => t.tag === "link");
  expect(links.some(t => t.attrs.rel === "canonical")).toBe(true);
  expect(links.some(t => t.attrs.rel === "icon" && t.attrs.href === "/icon.png")).toBe(true);
});

test("renderMetaTags returns empty array for null/non-object metadata", () => {
  expect(renderMetaTags(null)).toEqual([]);
  expect(renderMetaTags("string")).toEqual([]);
  expect(renderMetaTags(42)).toEqual([]);
});

test("renderResolved composes ancestor layouts around the route component", async () => {
  const Layout = props => React.createElement("section", { className: "layout" }, props.children);
  const Page = ctx => React.createElement("h1", null, `id=${String(ctx.params.id)}`);
  const myApp = app({
    routes: [
      group("/dashboard", {
        id: "dash",
        layout: lazy(async () => ({ default: Layout, __esModule: true })),
        routes: [
          route("/users/:id", {
            id: "user",
            module: lazy(async () => ({ default: Page, __esModule: true })),
          }),
        ],
      }),
    ],
  });
  const result = await dispatch(myApp, "/dashboard/users/42");
  if (result.kind !== "render") {
    throw new Error("expected render");
  }
  const html = ReactDOMServer.renderToString(renderResolved(result.render));
  expect(html.includes('class="layout"')).toBe(true);
  expect(html.includes("id=42")).toBe(true);
});

test("renderBoundary returns notFound component for notFound result", async () => {
  const NotFound = () => React.createElement("p", null, "404");
  const myApp = app({
    routes: [route("/", { id: "home", module: homeModule() })],
  });
  const result = await dispatch(myApp, "/missing");
  const node = renderBoundary(result, { boundary: { notFound: NotFound } });
  const html = ReactDOMServer.renderToString(node);
  expect(html).toBe("<p>404</p>");
});

test("renderBoundary returns forbidden component for forbidden result", async () => {
  const Forbidden = () => React.createElement("p", null, "no");
  const myApp = app({
    routes: [
      route("/x", {
        id: "x",
        guard: () => false,
        module: homeModule(),
      }),
    ],
  });
  const result = await dispatch(myApp, "/x");
  const node = renderBoundary(result, { boundary: { forbidden: Forbidden } });
  const html = ReactDOMServer.renderToString(node);
  expect(html).toBe("<p>no</p>");
});

test("renderBoundary returns null for redirect / badRequest / methodNotAllowed", async () => {
  const myApp = app({
    routes: [
      route("/r", {
        id: "r",
        guard: () => { redirect("/x"); },
        module: homeModule(),
      }),
      route("/q", {
        id: "q",
        query: { n: codecs.query.int() },
        module: homeModule(),
      }),
      route("/m", {
        id: "m",
        methods: ["GET"],
        module: homeModule(),
      }),
    ],
  });
  const r1 = await dispatch(myApp, "/r");
  expect(renderBoundary(r1)).toBe(null);
  const r2 = await dispatch(myApp, "/q?n=NaN");
  expect(renderBoundary(r2)).toBe(null);
  const r3 = await dispatch(myApp, "/m", {
    request: { url: "/m", method: "POST", headers: {} },
  });
  expect(renderBoundary(r3)).toBe(null);
});

test("validatePrerenderConfig accepts well-formed config and rejects malformed", () => {
  expect(validatePrerenderConfig(null).kind).toBe("ok");
  expect(validatePrerenderConfig({}).kind).toBe("ok");
  expect(validatePrerenderConfig({ revalidate: 60 }).kind).toBe("ok");
  expect(validatePrerenderConfig({ revalidate: "1h" }).kind).toBe("ok");
  expect(validatePrerenderConfig({ revalidate: "never" }).kind).toBe("ok");
  expect(validatePrerenderConfig({ fallback: "static" }).kind).toBe("ok");

  const negative = validatePrerenderConfig({ revalidate: -1 });
  expect(negative.kind).toBe("error");
  const unitErr = validatePrerenderConfig({ revalidate: "1week" });
  expect(unitErr.kind).toBe("error");
  const fb = validatePrerenderConfig({ fallback: "wrong" });
  expect(fb.kind).toBe("error");
});

test("prerenderPlan enumerates static and parameterized routes", async () => {
  const myApp = app({
    routes: [
      route("/", {
        id: "home",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            prerender: { revalidate: "1h" },
          }),
        })),
      }),
      route("/products/:id", {
        id: "product",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            prerender: {
              paths: [{ id: "a" }, { id: "b" }],
              revalidate: 3600,
              fallback: "static",
            },
          }),
        })),
      }),
      route("/no-config", {
        id: "skip",
        module: lazy(async () => ({
          default: () => null,
        })),
      }),
    ],
  });
  const plan = await prerenderPlan(myApp);
  const ids = plan.map(entry => entry.routeId);
  expect(ids.includes("home")).toBe(true);
  expect(ids.includes("product")).toBe(true);
  expect(ids.includes("skip")).toBe(false);
  const productPaths = plan
    .filter(entry => entry.routeId === "product")
    .map(entry => entry.path)
    .sort();
  expect(productPaths).toEqual(["/products/a", "/products/b"]);
  const home = plan.find(entry => entry.routeId === "home");
  if (home != null) {
    expect(home.revalidate).toBe("1h");
  }
  const product = plan.find(entry => entry.routeId === "product");
  if (product != null) {
    expect(product.fallback).toBe("static");
  }
});

test("prerenderPlan throws on invalid prerender config", async () => {
  const myApp = app({
    routes: [
      route("/", {
        id: "bad",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            prerender: { revalidate: -10 },
          }),
        })),
      }),
    ],
  });
  let caught = null;
  try {
    await prerenderPlan(myApp);
  } catch (err) {
    caught = err;
  }
  expect(caught).not.toBe(null);
  expect(String(caught != null && caught.message != null ? caught.message : "").includes("revalidate")).toBe(true);
});

test("prerenderPlan accepts function-typed paths and inherits group prefix", async () => {
  const myApp = app({
    routes: [
      group("/g", {
        id: "g",
        routes: [
          route("/:slug", {
            id: "g.show",
            module: lazy(async () => ({
              default: () => null,
              config: membrane({
                prerender: {
                  paths: async () => [{ slug: "x" }, { slug: "y" }],
                },
              }),
            })),
          }),
        ],
      }),
    ],
  });
  const plan = await prerenderPlan(myApp);
  const paths = plan.map(entry => entry.path).sort();
  expect(paths).toEqual(["/g/x", "/g/y"]);
});

test("genes promises pass through dispatch unawaited by default (streaming model)", async () => {
  const myApp = app({
    routes: [
      route("/p/:id", {
        id: "product",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            genes: ctx => ({
              product: Promise.resolve({ id: ctx.params.id, name: "Widget" }),
            }),
          }),
        })),
      }),
    ],
  });
  const result = await dispatch(myApp, "/p/42");
  expect(result.kind).toBe("render");
  if (result.kind === "render") {
    expect(isGenePending(result.render.context.genes)).toBe(true);
    const resolved = await result.render.context.genes.product;
    expect(resolved.id).toBe("42");
    expect(resolved.name).toBe("Widget");
  }
});

test("awaitGenes resolves all promise values for SSR pipelines", async () => {
  const genes = {
    a: Promise.resolve(1),
    b: 2,
    c: Promise.resolve({ deep: "value" }),
  };
  const resolved = await awaitGenes(genes);
  expect(resolved.a).toBe(1);
  expect(resolved.b).toBe(2);
  expect(resolved.c.deep).toBe("value");
});

test("dispatch with awaitGenes: true resolves genes before returning", async () => {
  const myApp = app({
    routes: [
      route("/p/:id", {
        id: "product",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            genes: ctx => ({
              product: Promise.resolve({ id: ctx.params.id, name: "Widget" }),
              tags: Promise.resolve(["a", "b"]),
            }),
          }),
        })),
      }),
    ],
  });
  const result = await dispatch(myApp, "/p/42", { awaitGenes: true });
  expect(result.kind).toBe("render");
  if (result.kind === "render") {
    expect(isGenePending(result.render.context.genes)).toBe(false);
    expect(result.render.context.genes.product.id).toBe("42");
    expect(result.render.context.genes.tags).toEqual(["a", "b"]);
  }
});

test("awaitGenes surfaces a thrown signal from a gene promise", async () => {
  const myApp = app({
    routes: [
      route("/x", {
        id: "x",
        module: lazy(async () => ({
          default: () => null,
          config: membrane({
            genes: () => ({
              boom: Promise.reject(new Error("DB down")),
            }),
          }),
        })),
      }),
    ],
  });
  let caught = null;
  try {
    await dispatch(myApp, "/x", { awaitGenes: true });
  } catch (err) {
    caught = err;
  }
  expect(caught != null).toBe(true);
});

test("dispatch reads signal from request.signal when no options.signal", async () => {
  const controller = new AbortController();
  controller.abort();
  let caught = null;
  const myApp = app({
    routes: [route("/", { id: "root", module: homeModule() })],
  });
  try {
    await dispatch(myApp, "/", {
      request: {
        url: "/",
        method: "GET",
        headers: {},
        signal: controller.signal,
      },
    });
  } catch (err) {
    caught = err;
  }
  expect(isAbortError(caught)).toBe(true);
});
