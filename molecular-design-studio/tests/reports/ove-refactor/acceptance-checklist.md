# OVE Refactor Acceptance Checklist

This checklist defines the parity bar for the GeneCode OVE workbench. It is a manual and automated acceptance list, not a claim that the current OVE integration already passes every item.

## Test fixtures

- [ ] 2.7 kb circular plasmid loads with ordinary features, forward and reverse primers, and a selectable restriction-enzyme set.
- [ ] 10 kb annotated circular plasmid loads with source, origin, promoter, CDS, terminator, regulatory, gene, and misc-feature tracks.
- [ ] A feature and a selection that cross the circular origin preserve their two segments, length, and displayed sequence.
- [ ] Forward and reverse CDS translations agree with the biological strand and the stored translation qualifier.
- [ ] Ambiguous IUPAC bases remain visible and are not silently converted to A, T, G, or C.
- [ ] The large virtualization fixture can be opened without freezing the page or eagerly mounting every row.

## Sequence view

- [ ] The Sequence view uses a stable monospace grid with a ruler, base numbering, forward strand, reverse/complement strand, and row-end coordinates.
- [ ] Clicking a base places a caret; dragging selects bases; Shift extends the current selection.
- [ ] Selection coordinates are canonical half-open internally and convert to OVE inclusive ends without an off-by-one error.
- [ ] A circular selection crossing the origin displays as one logical selection and exposes the concatenated tail-plus-head sequence to Agent and tools.
- [ ] Insert, delete, replace, reverse-complement, and case changes update sequence length and all affected coordinates.
- [ ] Undo and redo restore sequence, feature, primer, cut-site, and selection state together.
- [ ] Copy and paste preserve sequence text without ruler digits, annotation labels, or whitespace.
- [ ] Empty selections, caret-only events, the first base, and the last base have deterministic behavior.

## Map view

- [ ] Circular and linear map views share the same document, selection, and current feature.
- [ ] Map tracks show feature direction with distinct forward and reverse arrows.
- [ ] Origin-spanning features render in both segments without being duplicated as two independent biological features.
- [ ] Feature labels avoid overlap or collapse predictably at narrow widths and high zoom-out levels.
- [ ] Zoom, pan, and fit-to-view preserve the selected feature and do not change sequence coordinates.
- [ ] Double-clicking a map feature opens the same inspector used by Sequence view.

## Both view and synchronization

- [ ] Both view keeps Sequence and Map panes aligned to the same document and selection.
- [ ] Changing a selection in either pane updates the other pane immediately.
- [ ] Editing in either pane updates the other pane after the command completes.
- [ ] Switching Map, Sequence, and Both does not reset zoom, selection, view mode, or unsaved state.
- [ ] Opening or closing the Agent panel resizes the editor instead of covering the active canvas.

## Annotations and primers

- [ ] Right-clicking a selection offers create annotation, create primer, copy, and reverse-complement actions.
- [ ] New annotations require a name and preserve start, end, strand, type, qualifiers, and color.
- [ ] Editing annotation coordinates validates bounds and rejects zero-length or inverted linear intervals.
- [ ] Primer records show oligo orientation separately from the top-strand interval and remain correct after edits.
- [ ] Feature color is stable across Sequence, Map, Both, reopen, and OVE round trips.
- [ ] Annotation changes are undoable and are included in the dirty-document state.

## Restriction enzymes

- [ ] The enzyme control starts with a named enzyme group and does not mark every enzyme as selected by default.
- [ ] Switching enzyme groups changes visible cut sites only; it does not mutate the sequence or annotations.
- [ ] Unique and repeated sites are distinguishable, and each label points to the correct motif coordinates.
- [ ] Cut-site labels do not overwhelm the sequence at default zoom; dense labels are hidden or collapsed predictably.
- [ ] Circular sites near the origin render correctly in both Sequence and Map views.
- [ ] A cloning workflow can use the selected enzyme group when proposing a design.

## Translation

- [ ] CDS translation is shown directly under the correct strand and reading frame.
- [ ] Reverse-strand CDS translation uses the reverse complement before translation.
- [ ] Frame, codon-start, stop codon, and ambiguous-codon behavior are explicit and stable.
- [ ] Translation rows stay aligned after insertion, deletion, zoom, resize, and view switching.
- [ ] A CDS without a valid complete codon does not display stale amino acids.

## Keyboard and desktop behavior

- [ ] Cmd/Ctrl+C, V, X, Z, Shift+Z, A, and Escape have documented, testable behavior in the active editor.
- [ ] Keyboard shortcuts do not fire while typing in a text field or Agent composer.
- [ ] Delete and Backspace require an editable document and provide a visible read-only explanation otherwise.
- [ ] Document tabs preserve independent sequence, selection, zoom, dirty state, and undo history.
- [ ] Closing a dirty document asks for confirmation; closing a clean document does not.
- [ ] Tooltips identify unfamiliar icon-only controls and buttons have accessible names.

## Agent and review gate

- [ ] Agent reads the current document and current selection, including selected feature and origin-spanning selection state.
- [ ] Agent proposes cloning or editing operations as a structured preview before changing the document.
- [ ] Preview shows affected sequence, features, primers, cut sites, translations, and coordinate changes.
- [ ] User confirmation is required before applying a design to the active document.
- [ ] Applied Agent changes are one undoable transaction and can be rolled back.
- [ ] Failed or rejected operations leave the active document unchanged and explain the validation error.

## Accessibility and resilience

- [ ] All toolbar buttons, tabs, selectors, dialogs, map controls, and Agent controls have accessible names and keyboard focus states.
- [ ] Focus order follows the visible desktop layout and does not trap focus in a collapsed panel.
- [ ] Selection, active feature, current view, read-only state, and errors are communicated without color alone.
- [ ] Text remains readable at 200% zoom and at narrow desktop widths without controls overlapping the sequence.
- [ ] Long names, long sequences, unknown feature types, and unsupported qualifiers do not break the layout.
- [ ] Empty, malformed, ambiguous, and very large sequence inputs produce actionable errors rather than blank panels.

## Performance

- [ ] Opening a 2.7 kb plasmid is responsive and completes without visible layout shift.
- [ ] Opening a 10 kb annotated plasmid keeps scroll, selection, and map interactions responsive.
- [ ] The large fixture uses row virtualization or equivalent windowing; off-screen rows are not all mounted.
- [ ] Typing, selecting, and scrolling remain responsive on a 250 kb sequence.
- [ ] Restriction scans and translation calculations do not block the main thread for ordinary plasmids.
- [ ] A long-running operation exposes progress or a busy state and can be cancelled where appropriate.
- [ ] No console errors, uncaught promise rejections, or repeated React keys occur during the fixture flows.

## Release gate

- [ ] Focused fixture and invariant tests pass.
- [ ] Full unit/component test suite passes.
- [ ] Typecheck, lint, production build, and whitespace checks pass.
- [ ] Manual screenshots are captured for Sequence, Map, Both, Agent-open, origin selection, reverse CDS translation, enzyme-group selection, and the large-sequence scroll path.
- [ ] Any item left unchecked is recorded with a linked issue and an explicit release decision.
