/* @flow strict */

import { buildPath, combinePaths, compilePath } from "./Path";
import type {
  AnyParams,
  App,
  CompiledPath,
  PrerenderConfig,
  Revalidate,
  RouteNode,
} from "./Types";

export type PrerenderEntry = {
  +routeId: string,
  +pattern: string,
  +path: string,
  +params: AnyParams,
  +revalidate: ?Revalidate,
  +fallback: ?("static" | "dynamic" | "blocking"),
};

export type PrerenderValidation =
  | { +kind: "ok" }
  | { +kind: "error", +messages: $ReadOnlyArray<string> };

export function validatePrerenderConfig<P: AnyParams>(
  config: ?PrerenderConfig<P>,
): PrerenderValidation {
  if (config == null) {
    return { kind: "ok" };
  }
  const errors: Array<string> = [];

  if (config.revalidate != null) {
    const r = config.revalidate;
    if (typeof r === "number") {
      if (!Number.isFinite(r)) {
        errors.push("revalidate: numeric value must be finite");
      } else if (r < 0) {
        errors.push("revalidate: numeric value must be >= 0");
      }
    } else if (typeof r === "string") {
      if (r !== "never" && !/^\d+(?:ms|s|m|h|d)$/.test(r)) {
        errors.push(`revalidate: "${r}" is not a recognized duration ("never" or N(ms|s|m|h|d))`);
      }
    } else {
      errors.push("revalidate: must be number or string");
    }
  }

  if (config.fallback != null) {
    if (config.fallback !== "static" && config.fallback !== "dynamic" && config.fallback !== "blocking") {
      errors.push(`fallback: unknown mode "${String(config.fallback)}" (expected static | dynamic | blocking)`);
    }
  }

  return errors.length === 0 ? { kind: "ok" } : { kind: "error", messages: errors };
}

function findCombinedPath(
  nodes: $ReadOnlyArray<RouteNode>,
  target: RouteNode,
  ancestorPath: CompiledPath,
): ?CompiledPath {
  for (const node of nodes) {
    const combined = combinePaths(ancestorPath, node.path);
    if (node === target) {
      return combined;
    }
    if (node.kind === "group") {
      const inner = findCombinedPath(node.routes, target, combined);
      if (inner != null) {
        return inner;
      }
    }
  }
  return null;
}

async function expandRoute(
  route: RouteNode,
  combinedPath: CompiledPath,
  acc: Array<PrerenderEntry>,
): Promise<void> {
  if (route.kind !== "route") {
    return;
  }
  const state = route.module.state();
  let mod: mixed;
  if (state.status === "loaded") {
    mod = state.value;
  } else {
    try {
      mod = await route.module.load();
    } catch (_err) {
      return;
    }
  }
  const config = mod != null && typeof mod === "object"
    ? (mod as $FlowFixMe).config
    : null;
  const prerender: ?PrerenderConfig<AnyParams> = config != null
    ? (config as $FlowFixMe).prerender
    : null;
  if (prerender == null) {
    return;
  }
  const validation = validatePrerenderConfig(prerender);
  if (validation.kind === "error") {
    throw new Error(
      `Invalid prerender config for route "${route.id}": ${validation.messages.join("; ")}`,
    );
  }

  const fallback = prerender.fallback ?? null;
  const revalidate = prerender.revalidate ?? null;

  let paths: $ReadOnlyArray<AnyParams> | null = null;
  if (prerender.paths != null) {
    if (typeof prerender.paths === "function") {
      const result = await prerender.paths();
      paths = result;
    } else {
      paths = prerender.paths;
    }
  }

  if (paths == null) {
    acc.push({
      routeId: route.id,
      pattern: combinedPath.pattern,
      path: combinedPath.pattern,
      params: ({} as AnyParams),
      revalidate,
      fallback,
    });
    return;
  }

  for (const params of paths) {
    let path: string;
    try {
      path = buildPath(combinedPath, params);
    } catch (err) {
      const reason = err != null && typeof (err as $FlowFixMe).message === "string"
        ? (err as $FlowFixMe).message
        : "unknown error";
      throw new Error(
        `Failed to build prerender path for route "${route.id}": ${reason}`,
      );
    }
    acc.push({
      routeId: route.id,
      pattern: combinedPath.pattern,
      path,
      params,
      revalidate,
      fallback,
    });
  }
}

async function walk(
  nodes: $ReadOnlyArray<RouteNode>,
  parentPath: CompiledPath,
  acc: Array<PrerenderEntry>,
): Promise<void> {
  for (const node of nodes) {
    const combined = combinePaths(parentPath, node.path);
    if (node.kind === "group") {
      await walk(node.routes, combined, acc);
    } else {
      await expandRoute(node, combined, acc);
    }
  }
}

export async function prerenderPlan(app: App): Promise<$ReadOnlyArray<PrerenderEntry>> {
  const acc: Array<PrerenderEntry> = [];
  const root: CompiledPath = compilePath("/");
  await walk(app.routes, root, acc);
  return acc;
}

void findCombinedPath;
