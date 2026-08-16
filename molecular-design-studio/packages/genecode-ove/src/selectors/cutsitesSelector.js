import shortid from "shortid";
import circularSelector from "./circularSelector";
import sequenceSelector from "./sequenceSelector";
import restrictionEnzymesSelector from "./restrictionEnzymesSelector";
import cutsiteLabelColorSelector from "./cutsiteLabelColorSelector";
import { createSelector } from "reselect";
import { isEqual } from "lodash-es";

import { flatMap as flatmap, map } from "lodash-es";
import { getCutsitesFromSequence } from "@teselagen/sequence-utils";
import { getLowerCaseObj } from "../utils/arrayUtils";

// [{ args: {sequence,circular,enzymeList,cutsiteLabelColors}, result }]
const cutsitesCache = [];

function getCachedResult(argsObj) {
  const idx = cutsitesCache.findIndex(
    entry =>
      entry &&
      isEqual(entry.args, argsObj)
  );
  if (idx === -1) return;
  const hit = cutsitesCache[idx];
  return hit.result;
}

function setCachedResult(
  argsObj,
  result,
  cacheSize = 1
) {
  cutsitesCache.push({
    args: argsObj,
    result
  });
  //keep cache size manageable
  if (cutsitesCache.length > cacheSize) cutsitesCache.shift();
}

function cutsitesSelector(
  sequence,
  circular,
  enzymeList,
  cutsiteLabelColors,
  editorSize = 1
) {
  const cachedResult = getCachedResult({
    sequence,
    circular,
    enzymeList,
    cutsiteLabelColors
  });
  if (cachedResult) {
    return cachedResult;
  }
  //get the cutsites grouped by enzyme
  const cutsitesByName = getLowerCaseObj(
    getCutsitesFromSequence(sequence, circular, map(enzymeList))
  );
  //tag each cutsite with a unique id
  const cutsitesById = {};
  Object.keys(cutsitesByName).forEach(function (enzymeName) {
    const cutsitesForEnzyme = cutsitesByName[enzymeName];
    cutsitesForEnzyme.forEach(function (cutsite) {
      const numberOfCuts = cutsitesByName[enzymeName].length;
      const uniqueId = shortid();
      cutsite.id = uniqueId;
      cutsite.numberOfCuts = numberOfCuts;
      cutsite.annotationType = "cutsite";
      cutsitesById[uniqueId] = cutsite;
      // A-UI-001: default label colors are dark and readable on the light
      // theme (upstream salmon/lightblue/lightgrey measured 1.5–2.5:1
      // contrast). Callers can still override via cutsiteLabelColors.
      const mergedCutsiteColors = Object.assign(
        { single: "#b3372f", double: "#2f6f9f", multi: "#6b7280" },
        cutsiteLabelColors
      );
      if (numberOfCuts === 1) {
        cutsite.labelColor = mergedCutsiteColors.single;
        cutsite.labelClassName = "singleCutter";
        cutsite.labelClassname = cutsite.labelClassName;
      } else if (numberOfCuts === 2) {
        cutsite.labelColor = mergedCutsiteColors.double;
        cutsite.labelClassName = "doubleCutter";
        cutsite.labelClassname = cutsite.labelClassName;
      } else {
        cutsite.labelColor = mergedCutsiteColors.multi;
        cutsite.labelClassName = "multiCutter";
        cutsite.labelClassname = cutsite.labelClassName;
      }
    });
  });
  // create an array of the cutsites
  const cutsitesArray = flatmap(cutsitesByName, function (cutsitesForEnzyme) {
    return cutsitesForEnzyme;
  });
  const result = {
    cutsitesByName,
    cutsitesById,
    cutsitesArray
  };
  setCachedResult(
    {
      sequence,
      circular,
      enzymeList,
      cutsiteLabelColors
    },
    result,
    editorSize
  );
  return result;
}

// PATCH (A-ENG-002): the editor count is threaded through as the third
// selector argument (computed in withEditorProps/mapStateToProps where the
// full store IS available). This composed selector is invoked with the
// per-editor state slice (`editorState`), NOT the full store — an earlier
// attempt that read `state.VectorEditor` here always evaluated to 0, which
// silently disabled the cutsite cache (capacity 0 -> every call recomputed
// getCutsitesFromSequence). Fall back to the same capacity 1 that upstream
// effectively had when no count is passed.
const editorSizeSelector = (state, props, editorSize) =>
  // Only a numeric capacity is meaningful. The composed selector is also
  // invoked as the first input of filteredCutsitesSelector, which forwards
  // `enzymeGroupsOverride` as the third argument — a truthy object would
  // otherwise become the capacity and `length > <object>` (NaN) would never
  // evict, leaking the cache.
  typeof editorSize === "number" ? editorSize : 1;

export default createSelector(
  sequenceSelector,
  circularSelector,
  restrictionEnzymesSelector,
  cutsiteLabelColorSelector,
  editorSizeSelector,
  cutsitesSelector
);

// PATCH (A-ENG-002): exported for the engine regression tests
// (scripts/editor-size-cache.test.mjs).
export { cutsitesSelector, editorSizeSelector };
