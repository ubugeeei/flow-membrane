/* @flow strict */

import type { RouteMetadata } from "./Types";

type Tag =
  | { +tag: "title", +text: string }
  | {
      +tag: "meta",
      +attrs: { +[string]: string },
    }
  | {
      +tag: "link",
      +attrs: { +[string]: string },
    };

function isMetadata(value: mixed): boolean {
  return value != null && typeof value === "object";
}

function pushMeta(tags: Array<Tag>, attrs: { +[string]: string }): void {
  tags.push({ tag: "meta", attrs });
}

function stringValue(value: mixed): ?string {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export function renderMetaTags(metadata: mixed): $ReadOnlyArray<Tag> {
  const tags: Array<Tag> = [];
  if (!isMetadata(metadata)) {
    return tags;
  }
  const m: RouteMetadata = metadata as $FlowFixMe as RouteMetadata;

  const title = stringValue(m.title);
  if (title != null) {
    tags.push({ tag: "title", text: title });
    pushMeta(tags, { property: "og:title", content: title });
  }

  const description = stringValue(m.description);
  if (description != null) {
    pushMeta(tags, { name: "description", content: description });
    pushMeta(tags, { property: "og:description", content: description });
  }

  const canonical = stringValue(m.canonical);
  if (canonical != null) {
    tags.push({ tag: "link", attrs: { rel: "canonical", href: canonical } });
  }

  const robots = stringValue(m.robots);
  if (robots != null) {
    pushMeta(tags, { name: "robots", content: robots });
  }

  if (m.og != null && typeof m.og === "object") {
    for (const key of Object.keys(m.og)) {
      const value = stringValue((m.og as $FlowFixMe)[key]);
      if (value != null) {
        pushMeta(tags, { property: `og:${key}`, content: value });
      }
    }
  }

  if (m.twitter != null && typeof m.twitter === "object") {
    for (const key of Object.keys(m.twitter)) {
      const value = stringValue((m.twitter as $FlowFixMe)[key]);
      if (value != null) {
        pushMeta(tags, { name: `twitter:${key}`, content: value });
      }
    }
  }

  if (Array.isArray(m.meta)) {
    for (const entry of m.meta) {
      if (entry == null || typeof entry !== "object") {
        continue;
      }
      const content = stringValue((entry as $FlowFixMe).content);
      if (content == null) {
        continue;
      }
      const attrs: { [string]: string } = { content };
      const name = stringValue((entry as $FlowFixMe).name);
      const property = stringValue((entry as $FlowFixMe).property);
      if (name != null) attrs.name = name;
      if (property != null) attrs.property = property;
      pushMeta(tags, attrs);
    }
  }

  if (Array.isArray(m.link)) {
    for (const entry of m.link) {
      if (entry == null || typeof entry !== "object") {
        continue;
      }
      const rel = stringValue((entry as $FlowFixMe).rel);
      const href = stringValue((entry as $FlowFixMe).href);
      if (rel == null || href == null) {
        continue;
      }
      const attrs: { [string]: string } = { rel, href };
      for (const key of Object.keys(entry as $FlowFixMe)) {
        if (key === "rel" || key === "href") {
          continue;
        }
        const value = stringValue((entry as $FlowFixMe)[key]);
        if (value != null) attrs[key] = value;
      }
      tags.push({ tag: "link", attrs });
    }
  }

  return tags;
}

export type RenderedTag = Tag;
