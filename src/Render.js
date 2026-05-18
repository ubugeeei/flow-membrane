/* @flow strict */

import * as React from "react";
import type {
  BoundaryConfig,
  DispatchResult,
  LayoutModule,
  ResolvedRender,
  RouteContext,
  AnyParams,
} from "./Types";

export type RenderOptions = {
  +boundary?: BoundaryConfig,
  +fallback?: React.Node,
};

function composeLayouts(
  layouts: $ReadOnlyArray<LayoutModule>,
  routeElement: React.Node,
): React.Node {
  const createElement: any = React.createElement;
  let element: React.Node = routeElement;
  for (let i = layouts.length - 1; i >= 0; i -= 1) {
    const Layout = layouts[i].default;
    element = createElement(Layout, { children: element });
  }
  return element;
}

function withSuspense(node: React.Node, fallback: ?React.Node): React.Node {
  const createElement: any = React.createElement;
  if (fallback == null) {
    return node;
  }
  return createElement(React.Suspense, { fallback }, node);
}

export function renderResolved(
  resolved: ResolvedRender,
  options?: RenderOptions,
): React.Node {
  const createElement: any = React.createElement;
  const RouteComponent = resolved.module.default;
  const ctx: RouteContext<AnyParams, mixed> = resolved.context;
  const routeElement = createElement(RouteComponent, ctx);
  const composed = composeLayouts(resolved.layouts, routeElement);
  const fallback = options?.fallback ?? (
    options?.boundary?.loading != null
      ? createElement(options.boundary.loading, {})
      : null
  );
  return withSuspense(composed, fallback);
}

export function renderBoundary(
  result: DispatchResult,
  options?: RenderOptions,
): React.Node {
  const createElement: any = React.createElement;
  if (result.kind === "render") {
    return renderResolved(result.render, options);
  }
  if (result.kind === "notFound") {
    const Component = options?.boundary?.notFound;
    if (Component != null) {
      return createElement(Component, {});
    }
    return null;
  }
  if (result.kind === "forbidden") {
    const Component = options?.boundary?.forbidden;
    if (Component != null) {
      return createElement(Component, {});
    }
    return null;
  }
  // redirect, badRequest, methodNotAllowed: host handles HTTP-level response
  return null;
}
