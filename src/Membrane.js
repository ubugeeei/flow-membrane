/* @flow strict */

import type {
  AnyParams,
  MembraneConfig,
} from "./Types";

export function membrane<Params: AnyParams = AnyParams, Genes = {}>(
  config: MembraneConfig<Params, Genes>,
): MembraneConfig<Params, Genes> {
  return Object.freeze({
    prerender: config.prerender,
    genes: config.genes,
    guard: config.guard,
    boundary: config.boundary,
    metadata: config.metadata,
    revalidate: config.revalidate,
    action: config.action,
    actions: config.actions,
  });
}
