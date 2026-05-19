/* @flow strict */

import {
  matchPathSegments,
  parseQuery,
  urlSegments,
} from "./Path";
import type {
  AnyParams,
  AnyQuery,
  CompiledPath,
  RouteMatch,
  RouteNode,
} from "./Types";

function specificityFor(path: CompiledPath): number {
  let score = 0;
  for (const segment of path.segments) {
    if (segment.kind === "literal") {
      score += 100;
    } else if (segment.kind === "param") {
      score += 10;
    } else {
      score += 1;
    }
  }
  return score;
}

function sortBySpecificity(
  nodes: $ReadOnlyArray<RouteNode>,
): $ReadOnlyArray<RouteNode> {
  const indexed = nodes.map((node, index) => ({ node, index }));
  indexed.sort((a, b) => {
    const diff = specificityFor(b.node.path) - specificityFor(a.node.path);
    if (diff !== 0) {
      return diff;
    }
    return a.index - b.index;
  });
  return indexed.map(entry => entry.node);
}

function signatureFor(
  routeId: string,
  pathname: string,
  query: AnyQuery,
): string {
  const keys = Object.keys(query).sort();
  const parts: Array<string> = [];
  for (const key of keys) {
    const value: mixed = query[key];
    if (Array.isArray(value)) {
      const ordered = (value as $FlowFixMe as $ReadOnlyArray<mixed>).slice().sort();
      for (const entry of ordered) {
        parts.push(`${key}=${String(entry)}`);
      }
    } else if (value != null) {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return `${routeId}|${pathname}|${parts.join("&")}`;
}

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
      signature: "",
    };
  }

  if (frame.node.kind !== "group") {
    return null;
  }
  const groupNode = frame.node;
  const newAncestors = frame.ancestors.concat([groupNode]);
  for (const child of sortBySpecificity(groupNode.routes)) {
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

  for (const root of sortBySpecificity(routes)) {
    const frame: Frame = {
      node: root,
      ancestors: [],
      consumedPath: "",
      mergedParams: {} as AnyParams,
    };
    const match = attemptMatch(frame, segments);
    if (match != null) {
      const pathname = url.pathname;
      const query = parseQuery(url);
      return {
        route: match.route,
        pathname,
        params: match.params,
        query,
        ancestors: match.ancestors,
        matchedPath: match.matchedPath === "" ? "/" : match.matchedPath,
        signature: signatureFor(match.route.id, pathname, query),
      };
    }
  }

  return null;
}
