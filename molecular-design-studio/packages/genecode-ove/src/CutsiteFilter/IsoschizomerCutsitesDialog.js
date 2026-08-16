import { compose } from "recompose";
import { wrapDialog } from "@teselagen/ui";
import withEditorProps from "../withEditorProps";
import { withRestrictionEnzymes } from "./withRestrictionEnzymes";
import IsoschizomerCutsitesBody from "./IsoschizomerCutsitesBody";

/**
 * Lists every enzyme that cuts the same position (isoschizomers). Opened from
 * a merged cut-site label in the Sequence view (e.g. "VpaKutJI +4"), where
 * SnapGene-style dedup collapses a dozen enzymes into one label.
 *
 * Props: { enzymeNames: string[] } — the full enzyme list at that cut
 * position. The render logic lives in IsoschizomerCutsitesBody (kept
 * import-light for tests); this file only wires up the dialog HOCs.
 */
export const IsoschizomerCutsitesDialog = compose(
  withEditorProps,
  withRestrictionEnzymes,
  wrapDialog({
    isDraggable: true,
    getDialogProps: props => ({
      title: `${props.enzymeNames?.length ?? 1} enzymes at this cut site`
    })
  })
)(IsoschizomerCutsitesBody);

export default IsoschizomerCutsitesDialog;
