/* @flow strict */

import type * as React from "react";
import {
  app,
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
} from "flow-membrane";
import type {
  App,
  DispatchResult,
  Guard,
  Lazy,
  MembraneConfig,
  Middleware,
  Navigation,
  ParamCodec,
  RouteContext,
  RouteMatch,
  RouteModule,
  RouteNode,
} from "flow-membrane";

type ProductParams = { +id: string };
type ProductGenes = { +product: { +id: string, +name: string } };

function ProductRoute(props: RouteContext<ProductParams, mixed>): React.Node {
  const genes = props.genes as $FlowFixMe as ProductGenes;
  return <span>{genes.product.name}</span>;
}

const ProductLazy: Lazy<RouteModule<ProductParams, mixed>> = lazy<RouteModule<ProductParams, mixed>>(async () => ({
  default: ProductRoute,
  config: membrane<ProductParams, ProductGenes>({
    genes: ctx => ({ product: { id: ctx.params.id, name: "p" } }),
  }),
}));

const authGuard: Guard<{}> = guard(async ({ session }) => {
  if (session.user == null) {
    redirect("/login");
  }
  return true;
});

const localeMw: Middleware = middleware(async (ctx, next) => {
  ctx.state.locale = "ja";
  return next();
});

const productIdCodec: ParamCodec<string> = codecs.id<string>();
void productIdCodec;

function EmptyRoute(_props: RouteContext<{}, mixed>): React.Node {
  return <div />;
}

const homeModule: Lazy<RouteModule<{}, mixed>> = lazy<RouteModule<{}, mixed>>(async () => ({ default: EmptyRoute }));

const routes: $ReadOnlyArray<RouteNode> = [
  route("/", { id: "home", module: homeModule }),
  route("/products/:id", {
    id: "product.show",
    module: ProductLazy,
  }),
  group("/dashboard", {
    id: "dashboard",
    guard: authGuard,
    routes: [
      route("/", { id: "dashboard.home", module: homeModule }),
    ],
  }),
];

const myApp: App = app({
  middleware: [localeMw],
  routes,
});

const probe: ?RouteMatch = myApp.match("/products/abc");
void probe;

async function run(): Promise<void> {
  const result: DispatchResult = await dispatch(myApp, "/products/abc");
  if (result.kind === "render") {
    void result.render.context.params;
  }
}

void run;
void matchRoute;
void notFound;
void forbidden;

type _Config = MembraneConfig<ProductParams, ProductGenes>;
const _maybeConfig: ?_Config = null;
void _maybeConfig;
type _Nav = Navigation;
const _maybeNav: ?_Nav = null;
void _maybeNav;
