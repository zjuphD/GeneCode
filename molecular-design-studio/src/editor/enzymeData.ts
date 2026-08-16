/**
 * Typed access to the enzyme data single source of truth (A-ALG-002).
 *
 * `enzyme-data.json` is the canonical record of Type IIS (Golden Gate) enzyme
 * recognition sites, cut positions and grouping. This module is the only
 * place that imports it; every consumer (assembly.ts internal-site checks,
 * the Golden Gate menus, the wizard enzyme dropdowns) derives its data from
 * here so the four hand-maintained copies collapse into one.
 */
import raw from "./enzyme-data.json";

export interface TypeIisEnzyme {
  recognitionSite: string;
  /** 0-based cut positions on the forward strand, measured from motif start. */
  cutsTop: number[];
  cutsBottom: number[];
  overhangLength: number;
  aliases?: string[];
  /** Set when this name is an isoschizomer of another entry. */
  isAliasOf?: string;
}

export interface EnzymeData {
  schemaVersion: number;
  typeIis: Record<string, TypeIisEnzyme>;
  goldenGateGroup: string[];
  commonCloningGroup: string[];
}

const data = raw as unknown as EnzymeData;

// Fail fast on structural drift instead of surfacing a TypeError downstream
// (A-ALG-002): a typo in the JSON must be loud, not silent.
if (!data.typeIis || !Array.isArray(data.goldenGateGroup)) {
  throw new Error("enzyme-data.json is missing required fields (typeIis / goldenGateGroup)");
}

/** Type IIS recognition sites used for internal-site checks (assembly.ts). */
export const TYPE_IIS_SITES: Record<string, string> = Object.fromEntries(
  Object.entries(data.typeIis).map(([name, enzyme]) => [name, enzyme.recognitionSite]),
);

/** Canonical Golden Gate enzyme group (menu + wizard dropdown). */
export const GOLDEN_GATE_ENZYMES: readonly string[] = data.goldenGateGroup;

/** Common cloning group used by the enzyme mode menu. */
export const COMMON_CLONING_ENZYMES: readonly string[] = data.commonCloningGroup;

/**
 * Type IIS enzymes surfaced in the agent cloning setup (primary cutters).
 * Must stay a subset of GOLDEN_GATE_ENZYMES — pinned by enzymeData.test.ts.
 */
export const COMMON_TYPE_IIS_ENZYMES: readonly string[] = ["BsaI", "BsmBI", "Esp3I", "SapI"];

/** The most common Golden Gate cutter, used as the wizard/panel default. */
export const DEFAULT_GOLDEN_GATE_ENZYME = "BsaI";

export function getTypeIisEnzyme(name: string): TypeIisEnzyme | undefined {
  return data.typeIis[name];
}

/** Canonical enzyme name for an alias (e.g. Esp3I → BsmBI). */
export function canonicalEnzymeName(name: string): string {
  const enzyme = data.typeIis[name];
  if (enzyme?.isAliasOf) return enzyme.isAliasOf;
  return name;
}
