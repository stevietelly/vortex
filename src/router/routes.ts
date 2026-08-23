import ExamplePage from "@/pages/ExamplePage";
import React, { type ComponentType, type ReactElement } from "react";

// One def per route — co-locates everything a page needs to declare.
type RouteDef<P> = {
  /** The page component. Receives no props — it pulls params via useRouteParams. */
  component: ComponentType<unknown>;
  /** Default window title for this route. */
  title: string;
  /** Phantom: shape of the params accepted by this route. */
  params: P;
  /** Optional: re-mount the page on re-entry (e.g. reset loader state). */
  remountKey?: () => string;
};

/** Builds a route definition, preserving the params shape as its type. */
function route<P>(def: RouteDef<P>): RouteDef<P> {
  return def;
}

export const ROUTES = {
  home: route({
  	component: ExamplePage,
  	title: "Vortex Downloader",
  	params: undefined,
  }),
} satisfies Record<string, RouteDef<unknown>>;

// Derived: union of route names
export type RouteName = keyof typeof ROUTES;

// Derived: per-route param shapes
export type RouteParams = { [K in RouteName]: (typeof ROUTES)[K]["params"] };

// Derived: page element map (consumed by the window)
export const PAGES: Record<RouteName, ReactElement> = Object.fromEntries(
  Object.entries(ROUTES).map(([name, def]) => [
    name,
    React.createElement(def.component, {
      key: def.remountKey?.(),
    }),
  ]),
) as Record<RouteName, ReactElement>;
