/* @flow strict */

import * as React from "react";
import type {
  BoundaryConfig,
  DispatchResult,
  LayoutModule,
  ResolvedRender,
  RouteContext,
  RouteError,
  AnyParams,
} from "./Types";

export const RouteErrorContext: React.Context<?RouteError> = React.createContext<?RouteError>(null);

type ErrorBoundaryProps = {
  +fallback: React.ComponentType<{ +error: mixed, +reset: () => void }>,
  +children: React.Node,
};
type ErrorBoundaryState = { error: mixed };

class RouteErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: mixed): ErrorBoundaryState {
    return { error };
  }
  componentDidCatch(_error: mixed, _info: { +componentStack: string, ... }): void {
  }
  reset = (): void => {
    this.setState({ error: null });
  };
  render(): React.Node {
    if (this.state.error != null) {
      const Fallback = this.props.fallback;
      const createElement: any = React.createElement;
      return createElement(Fallback, { error: this.state.error, reset: this.reset });
    }
    return this.props.children;
  }
}

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
  const suspended = withSuspense(composed, fallback);
  const ErrorFallback = options?.boundary?.error;
  if (ErrorFallback == null) {
    return suspended;
  }
  return createElement(
    RouteErrorBoundary,
    { fallback: ErrorFallback },
    suspended,
  );
}

function wrapWithError(node: React.Node, error: RouteError): React.Node {
  const createElement: any = React.createElement;
  return createElement(RouteErrorContext.Provider, { value: error }, node);
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
    const error: RouteError = { kind: "notFound", signal: result.signal };
    const Component = options?.boundary?.notFound;
    if (Component != null) {
      return wrapWithError(createElement(Component, { signal: result.signal }), error);
    }
    return null;
  }
  if (result.kind === "forbidden") {
    const error: RouteError = { kind: "forbidden", signal: result.signal };
    const Component = options?.boundary?.forbidden;
    if (Component != null) {
      return wrapWithError(createElement(Component, { signal: result.signal }), error);
    }
    return null;
  }
  if (result.kind === "badRequest") {
    const error: RouteError = { kind: "badRequest", signal: result.signal };
    const Component = options?.boundary?.badRequest;
    if (Component != null) {
      return wrapWithError(createElement(Component, { signal: result.signal }), error);
    }
    return null;
  }
  if (result.kind === "methodNotAllowed") {
    const error: RouteError = { kind: "methodNotAllowed", signal: result.signal };
    const Component = options?.boundary?.methodNotAllowed;
    if (Component != null) {
      return wrapWithError(createElement(Component, { signal: result.signal }), error);
    }
    return null;
  }
  // redirect: host handles HTTP-level response
  return null;
}
