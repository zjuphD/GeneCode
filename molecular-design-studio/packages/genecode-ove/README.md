# GeneCode OVE fork

This directory is a source-level fork scaffold of `@teselagen/ove@0.8.42` for
GeneCode. The upstream source was copied from the installed package in this
workspace; it is kept here so future editor changes do not modify
`node_modules` and do not depend on a generated bundle patch.

## Current fork extensions

- `createVectorEditor()` creates an isolated Redux store by default for every
  editor instance. Existing callers can still pass a Redux `store` explicitly.
- `createVectorEditor()` accepts `storeFactory` (and the compatibility alias
  `createStore`) when GeneCode needs to provide a configured store.
- `<Editor>` accepts `panelComponents` as the explicit extension API. The
  legacy `panelMap` prop remains supported and takes precedence when both are
  supplied.
- The default panel registry is exposed as `defaultPanelMap` for composition
  and inspection.
- `GeneCodeSequencePanel` provides the first source-level Sequence renderer
  with shared row layout, bounded visible-row rendering, and injectable OVE
  interaction props.

Example:

```js
import { Editor, defaultPanelMap } from "@genecode/ove";

const panelComponents = {
  ...defaultPanelMap,
  sequence: { ...defaultPanelMap.sequence, comp: GeneCodeSequenceView }
};

<Editor panelComponents={panelComponents} />;
```

## Upstream provenance

The upstream package name, version, repository, and full upstream README are
preserved in `package.json`, `NOTICE`, and `UPSTREAM-README.md`. This fork
starts from the npm artifact `@teselagen/ove@0.8.42` and retains its MIT
license. GeneCode-specific changes are intentionally limited to the files
listed in `NOTICE`.

## Local checks

Run the package-only structural smoke check from this directory:

```sh
npm run smoke
```

The root application resolves `@teselagen/ove` to this source tree through its
Vite alias. Keep the root build and browser regression checks in the release
gate whenever this package changes.
