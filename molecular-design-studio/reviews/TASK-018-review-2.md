# TASK-018 Review 2

Status: changes_requested

## Finding

The production callback signature is now correct, but the requested regression
test was not added to `src/components/OveEditorHost.test.tsx`. The current test
suite never captures or invokes `onSelectionOrCaretChanged`, so the exact bug
from Review 1 could return unnoticed.

Add focused component tests that:

1. capture `onSelectionOrCaretChanged` from the props passed to
   `createVectorEditor`;
2. invoke it with `{ selectionLayer: { start: 2, end: 4 }, caretPosition: -1 }`
   and assert `onSelectionChange` receives `{ start: 2, end: 4 }`;
3. invoke it with `{ selectionLayer: { start: -1, end: -1 }, caretPosition: 3 }`
   and assert the empty selection layer is forwarded so Editor clears context;
4. prove a rerender uses the latest `onSelectionChange` callback without
   recreating the OVE editor.

Do not change production code unless a test exposes another issue. Rerun every
TASK-018 verification command.
