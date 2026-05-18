/* eslint-disable no-undef */

const {
  app,
  badRequest,
  codecs,
  dispatch,
  forbidden,
  group,
  guard,
  lazy,
  matchRoute,
  membrane,
  middleware,
  notFound,
  redirect,
  route,
  isBadRequest,
  isRedirect,
  isNotFound,
  isForbidden,
  isAbortError,
  AbortError,
  createNavigation,
  hrefFor,
  previewMatch,
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
  const myApp = app({
    routes: [
      route("/products/:id", { id: "product.show", module: homeModule() }),
    ],
  });
  expect(hrefFor(myApp, "product.show", { id: "42" })).toBe("/products/42");
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
