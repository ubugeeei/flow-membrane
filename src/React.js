/* @flow strict */

"use client";

import * as React from "react";
import { useCell } from "flow-cell/client";
import {
  createNavigation,
  previewMatch,
} from "./Navigation";
import { serializeQuery } from "./Path";
import type {
  App,
  LinkProps,
  Navigation,
  NavigationTarget,
  NavigateOptions,
} from "./Types";

const NavigationContext: React.Context<?Navigation> = React.createContext(null);
const AppContext: React.Context<?App> = React.createContext(null);
const MetadataContext: React.Context<mixed> = React.createContext(null);

let defaultNavigation: ?Navigation = null;

export function getDefaultNavigation(): Navigation {
  if (defaultNavigation == null) {
    const g: $FlowFixMe = globalThis;
    defaultNavigation = createNavigation({
      initial: g.location != null
        ? new URL(g.location.href)
        : undefined,
    });
  }
  return defaultNavigation;
}

export function NavigationProvider(props: {
  +navigation?: Navigation,
  +app?: App,
  +metadata?: mixed,
  +children?: React.Node,
}): React.Node {
  const navigation = props.navigation ?? getDefaultNavigation();
  const createElement: any = React.createElement;
  return createElement(
    NavigationContext.Provider,
    { value: navigation },
    createElement(
      AppContext.Provider,
      { value: props.app ?? null },
      createElement(
        MetadataContext.Provider,
        { value: props.metadata ?? null },
        props.children,
      ),
    ),
  );
}

export function MetadataProvider(props: {
  +metadata: mixed,
  +children?: React.Node,
}): React.Node {
  const createElement: any = React.createElement;
  return createElement(
    MetadataContext.Provider,
    { value: props.metadata },
    props.children,
  );
}

export function useMetadata(): mixed {
  return React.useContext(MetadataContext);
}

export function useNavigation(): Navigation {
  const ctx = React.useContext(NavigationContext);
  if (ctx != null) {
    return ctx;
  }
  return getDefaultNavigation();
}

export function useApp(): ?App {
  return React.useContext(AppContext);
}

export function useUrl(): URL {
  const navigation = useNavigation();
  return useCell(navigation.current);
}

export function useRouteMatch(): ?{
  +pathname: string,
  +params: { +[string]: mixed },
  +routeId: string,
} {
  const app = useApp();
  const url = useUrl();
  if (app == null) {
    return null;
  }
  const match = previewMatch(app, url);
  if (match == null) {
    return null;
  }
  return {
    pathname: match.pathname,
    params: match.params,
    routeId: match.routeId,
  };
}

export function navigate(
  target: NavigationTarget,
  options?: NavigateOptions,
): Promise<void> {
  return getDefaultNavigation().navigate(target, options);
}

function targetToHref(target: NavigationTarget): string {
  if (typeof target === "string") {
    return target;
  }
  if (target instanceof URL) {
    return target.pathname + target.search + target.hash;
  }
  const search = serializeQuery(target.query);
  const hash = target.hash != null && target.hash !== "" ? `#${target.hash.replace(/^#/, "")}` : "";
  return target.to + search + hash;
}

function shouldDelegateClick(event: SyntheticMouseEvent<HTMLAnchorElement>): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  if (event.button !== 0) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  const target = event.currentTarget;
  const linkTarget = target.getAttribute("target");
  if (linkTarget != null && linkTarget !== "" && linkTarget !== "_self") {
    return false;
  }
  return true;
}

export function Link(props: LinkProps): React.Node {
  const navigation = useNavigation();
  const app = useApp();
  const href = targetToHref(props.to);
  const createElement: any = React.createElement;

  const handleClick = React.useCallback(
    (event: SyntheticMouseEvent<HTMLAnchorElement>) => {
      if (props.onClick != null) {
        props.onClick(event);
      }
      if (!shouldDelegateClick(event)) {
        return;
      }
      event.preventDefault();
      navigation.navigate(props.to, {
        replace: props.replace,
        scroll: props.scroll,
        transition: true,
      });
    },
    [navigation, props],
  );

  const handlePointerEnter = React.useCallback(
    (_event: SyntheticEvent<HTMLAnchorElement>) => {
      if (app == null) {
        return;
      }
      if (props.prefetch !== "intent" && props.prefetch !== "viewport") {
        return;
      }
      const preview = previewMatch(app, props.to);
      if (preview == null) {
        return;
      }
      const node = app.routeById(preview.routeId);
      if (node != null && node.kind === "route") {
        node.module.preload();
      }
    },
    [app, props.prefetch, props.to],
  );

  return createElement(
    "a",
    {
      href,
      className: props.className,
      style: props.style,
      onClick: handleClick,
      onPointerEnter: handlePointerEnter,
      onFocus: handlePointerEnter,
    },
    props.children,
  );
}
