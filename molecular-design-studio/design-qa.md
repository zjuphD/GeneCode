# Double-strand sequence design QA

- Source visual truth: `/var/folders/10/dq3btc2j0x9_35tl9bd78dlm0000gn/T/codex-clipboard-7a641f56-ddd0-4b1b-a68b-6263677b321c.png`
- Implementation screenshot: `tests/reports/double-strand-implementation-760x520.jpg`
- Focused implementation crop: `tests/reports/double-strand-implementation-matched.jpg`
- Side-by-side evidence: `tests/reports/double-strand-reference-comparison.png`
- Browser viewport: 760 x 520 CSS px, device scale 1
- Source pixels: 666 x 217
- Focused implementation pixels: 666 x 217
- State: Sequence view, SYNPUC19V demo, Agent closed, no active selection in the captured frame

## Full-view comparison

The implementation keeps the editor chrome intact while presenting the sequence as repeated forward-strand, ruler, and reverse-complement groups. No panel overlap, clipping, or horizontal overflow is visible at the tested viewport.

## Focused comparison

The final focused crop matches the reference's reading density at approximately 58 bases per row. Both strands use high-contrast monospace text, the 5'/3' labels are distinct, the ruler forms a clear center line, and additional space separates consecutive double-strand groups. A restrained reverse-strand background remains as an intentional GeneCode affordance.

## Comparison history

1. Initial finding, P1: the reverse complement was too light and the 70-base row density made the two strands visually merge.
2. Fix: increased reverse-strand contrast, strengthened the ruler and direction labels, increased group spacing, and limited the default sequence density to a readable 11 px base step.
3. Post-fix evidence: `tests/reports/double-strand-reference-comparison.png` shows the source and final focused implementation at the same 666 x 217 pixel size.

## Fidelity surfaces

- Fonts and typography: monospace sequence text is 12.5 px with matched strand weight; ruler labels are visually subordinate.
- Spacing and layout rhythm: 58 bases per row, clear forward/ruler/reverse grouping, and increased inter-group whitespace.
- Colors and tokens: near-black bases, strong neutral ruler, and a subtle cool-gray reverse-strand lane.
- Image quality: native SVG text and lines remain sharp at 1x; no raster assets are used inside the editor.
- Copy and content: sequence bases, coordinate labels, and strand direction labels remain data-driven and unchanged.

## Interaction verification

- Clicking a sequence row updates the status to `Caret Between Bases 29 and 30`.
- Browser console still contains legacy OVE React compatibility warnings. These predate this visual change and did not affect sequence rendering or selection in this pass.

## Follow-up polish

- P3: migrate the remaining legacy OVE React APIs and local-storage warning path in a separate compatibility pass.

final result: passed

# Agent progress card design QA

## Source visual truth

- Source: `/var/folders/10/dq3btc2j0x9_35tl9bd78dlm0000gn/T/codex-clipboard-83491e38-658b-4083-b9ff-b8c271e007ce.png`
- Source dimensions: 520 x 520 px.
- Intent: a delivery/order-style card with a status pill, progress bar, vertical milestone timeline, active step, and completed/future states.

## Implementation evidence

- Full app capture: `/tmp/genecode-progress-artifacts/running-top.png`
- Focused component capture: `/tmp/genecode-progress-artifacts/agent-progress-card.png`
- Browser viewport: 1440 x 900 CSS px, device scale 1.
- Focused component capture: 351 x 344 CSS px; no density normalization required.
- State: Agent has a cloning goal; sequence context is complete; plan/tool/verification/result stages are waiting after the local Agent request returned HTTP 401. The active planning state is covered by the component test below.
- Component test: `AgentPanel.test.tsx` renders `phase="planning"` and asserts the plan step is active and the context step is complete.

## Comparison

### Full view

The implementation keeps the Agent card as a first-class right-side work surface while the sequence map remains the primary canvas. This is intentionally not a full-page clone of the source order screen; the source is used as the progress-card interaction pattern only.

### Focused region

The implementation matches the source pattern at the component level:

- white rounded card with a quiet border and elevation;
- compact status pill in the header;
- indigo progress bar;
- vertical timeline with connected milestones;
- check icon for completed context, outlined icon for future stages, and a separate active/review/error style for live states;
- secondary detail text and step counts without competing with the main label.

## Required fidelity surfaces

- Typography: GeneCode's existing Inter/system stack is retained; milestone labels use a 12px semibold tier and metadata uses a 10.5px muted tier for the same hierarchy as the source.
- Spacing/layout: 16px card padding, 50px milestone rhythm, 7px progress track, and a sticky card keep the timeline readable while the task stream scrolls.
- Colors/tokens: the card uses GeneCode indigo for progress/active states, green for completed context, amber for review, and red for error; these are mapped to existing semantic tokens rather than hard-coded state logic.
- Image/assets: no source imagery or avatar asset is required by this Agent variant; status icons use the existing MUI Rounded icon system.
- Copy/content: labels are molecular-workflow-specific (`读取序列上下文`, `生成执行计划`, `运行分子工具`, `复核候选结果`, `结果可用`) and the full user goal remains in the auditable objective node.
- Accessibility: the card is a named `region`, the bar is a semantic `progressbar`, each step has stable `data-testid` hooks, and active updates remain driven by the existing live session state.

## Comparison history

1. Initial implementation placed the card after the pinned context/goal nodes; at the bottom scroll position only part of the card was visible. Fixed by moving the card before the pinned summary and making it sticky. Evidence: `/tmp/genecode-progress-artifacts/running-top.png`.
2. Initial idle/error state incorrectly labeled a partially started task as `已完成` when no step was active. Fixed by distinguishing `待开始` from `已完成`. Evidence: `/tmp/genecode-progress-artifacts/agent-progress-card.png`.
3. The full user goal appeared twice in the DOM (objective node and card title), which broke an existing single-element assertion. Fixed by using the concise workspace title in the card and retaining the full goal in the objective node; 1005 tests now pass.

## Findings

- No actionable P0/P1/P2 visual findings remain for the requested progress-card pattern.
- P3 follow-up: optionally add an elapsed-time/assignee footer if the product wants to mirror the source card even more closely. The existing `AgentWorkingIndicator` already exposes elapsed time for live runs.
- Runtime caveat: the browser smoke attempt reached `http://127.0.0.1:8000/api/agent/chat` and received HTTP 401, so a real network-backed plan-to-tool transition remains an environment/configuration verification item, not a visual-card defect.

## Implementation checklist

- [x] Render a progress bar and vertical timeline.
- [x] Map context/plan/tool/validation/result to normalized Agent state.
- [x] Expose active, done, waiting, review, and error visual states.
- [x] Keep the existing detailed task nodes and tool logs for auditability.
- [x] Add a component test for the planning state.
- [x] Run browser capture and console check.

final result: passed
