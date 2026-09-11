import React from "react";
import { Classes, Tag } from "@blueprintjs/core";
import { map, sortBy } from "lodash-es";
import { showDialog } from "../GlobalDialogUtils";

/**
 * Body of the isoschizomer dialog, split out so tests can render it directly
 * without the wrapDialog / withEditorProps HOC stack. Lists every enzyme that
 * shares a cut site in this sequence, each rendered as a tag (name +
 * recognition site, when the enzyme data is known) and clickable to open the
 * per-enzyme details dialog.
 */
export default function IsoschizomerCutsitesBody({
  enzymeNames = [],
  allRestrictionEnzymes
}) {
  const sortedNames = sortBy([...new Set(enzymeNames)], name =>
    name.toLowerCase()
  );
  return (
    <div className={Classes.DIALOG_BODY}>
      <div>
        These enzymes share a cut site on this sequence. Their recognition
        sequences may differ:
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          marginTop: 6
        }}
      >
        {map(sortedNames, name => {
          const enzyme = allRestrictionEnzymes?.[name.toLowerCase()];
          const site = enzyme?.site || enzyme?.forwardRegex;
          return (
            <Tag
              key={name}
              minimal
              interactive
              style={{ margin: 3 }}
              onClick={() =>
                showDialog({
                  dialogType: "AdditionalCutsiteInfoDialog",
                  props: {
                    cutsiteOrGroupKey: name
                  }
                })
              }
              title={site ? `${name} — ${site}` : name}
            >
              {name}
              {site ? ` (${site})` : ""}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
