/* @flow strict */

function isThenable(value: mixed): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as $FlowFixMe).then === "function"
  );
}

export async function awaitGenes<G>(genes: G): Promise<G> {
  if (genes == null || typeof genes !== "object") {
    return genes;
  }
  if (isThenable(genes)) {
    return (await (genes as $FlowFixMe)) as G;
  }
  if (Array.isArray(genes)) {
    const out: Array<mixed> = [];
    for (const value of genes as $FlowFixMe) {
      out.push(isThenable(value) ? await (value as $FlowFixMe) : value);
    }
    return (out as $FlowFixMe as G);
  }
  const resolved: { [string]: mixed } = {};
  for (const key of Object.keys(genes as { ... })) {
    const value: mixed = (genes as $FlowFixMe)[key];
    if (isThenable(value)) {
      resolved[key] = await (value as $FlowFixMe);
    } else {
      resolved[key] = value;
    }
  }
  return (resolved as $FlowFixMe as G);
}

export function isGenePending<G>(genes: G): boolean {
  if (genes == null || typeof genes !== "object") {
    return false;
  }
  if (isThenable(genes)) {
    return true;
  }
  if (Array.isArray(genes)) {
    for (const value of genes as $FlowFixMe) {
      if (isThenable(value)) {
        return true;
      }
    }
    return false;
  }
  for (const key of Object.keys(genes as { ... })) {
    if (isThenable((genes as $FlowFixMe)[key])) {
      return true;
    }
  }
  return false;
}
