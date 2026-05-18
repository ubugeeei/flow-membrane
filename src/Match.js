/* @flow strict */

import {
  matchPathSegments,
  parseQuery,
  urlSegments,
} from "./Path";
import type {
  AnyParams,
  RouteMatch,
  RouteNode,
} from "./Types";

function ensureUrl(input: string | URL): URL {
  if (typeof input === "string") {
    if (input.startsWith("http://") || input.startsWith("https://")) {
      return new URL(input);
    }
    const base = "http://flow-membrane.local";
    const path = input.startsWith("/") ? input : `/${input}`;
    return new URL(path, base);
  }
  return input;
}

type Frame = {
  +node: RouteNode,
  +ancestors: $ReadOnlyArray<RouteNode>,
  +consumedPath: string,
  +mergedParams: AnyParams,
};

function attemptMatch(
  frame: Frame,
  remaining: $ReadOnlyArray<string>,
): ?RouteMatch {
  const attempt = matchPathSegments(frame.node.path, remaining);
  if (attempt == null) {
    return null;
  }

  const mergedParams: { [string]: mixed } = { ...frame.mergedParams } as $FlowFixMe;
  for (const key of Object.keys(attempt.params)) {
    mergedParams[key] = attempt.params[key];
  }

  if (frame.node.kind === "route") {
    if (attempt.remaining.length !== 0) {
      return null;
    }
    return {
      route: frame.node,
      pathname: frame.consumedPath + frame.node.path.pattern,
      params: mergedParams as AnyParams,
      query: {} as $FlowFixMe,
      ancestors: frame.ancestors,
      matchedPath: (frame.consumedPath === "/" ? "" : frame.consumedPath) + frame.node.path.pattern,
    };
  }

  if (frame.node.kind !== "group") {
    return null;
  }
  const groupNode = frame.node;
  const newAncestors = frame.ancestors.concat([groupNode]);
  for (const child of groupNode.routes) {
    const childFrame: Frame = {
      node: child,
      ancestors: newAncestors,
      consumedPath: (frame.consumedPath === "/" ? "" : frame.consumedPath) + groupNode.path.pattern,
      mergedParams: mergedParams as AnyParams,
    };
    const childMatch = attemptMatch(childFrame, attempt.remaining);
    if (childMatch != null) {
      return childMatch;
    }
  }

  return null;
}

export function matchRoute(
  routes: $ReadOnlyArray<RouteNode>,
  input: string | URL,
): ?RouteMatch {
  const url = ensureUrl(input);
  const segments = urlSegments(url);

  for (const root of routes) {
    const frame: Frame = {
      node: root,
      ancestors: [],
      consumedPath: "",
      mergedParams: {} as AnyParams,
    };
    const match = attemptMatch(frame, segments);
    if (match != null) {
      return {
        route: match.route,
        pathname: url.pathname,
        params: match.params,
        query: parseQuery(url),
        ancestors: match.ancestors,
        matchedPath: match.matchedPath === "" ? "/" : match.matchedPath,
      };
    }
  }

  return null;
}
