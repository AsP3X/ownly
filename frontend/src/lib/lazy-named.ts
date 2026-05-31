// Human: Wrap a named export in React.lazy's default-export shape.
// Agent: CALLS dynamic import(); RETURNS { default: namedComponent } for lazy() factories.

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

// Human: Factory resolves a module and picks one named export as the lazy default.
// Agent: READS exportName from imported module; RETURNS LazyExoticComponent for Suspense routes.
export function lazyNamed<P>(
  factory: () => Promise<Record<string, ComponentType<P>>>,
  exportName: string,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() =>
    factory().then((module) => ({
      default: module[exportName] as ComponentType<P>,
    })),
  );
}
