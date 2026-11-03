# Issue tracker: Local Markdown

Issues and specs live in `.scratch/`.

- Feature directory: `.scratch/<feature-slug>/`.
- Specification: `spec.md` within that directory.
- Implementation tickets: `issues/<NN>-<slug>.md`, numbered from `01`, one file per ticket.
- Triage status: a `Status:` line near the top; use `docs/agents/triage-labels.md`.
- Discussion: append under `## Comments` in the relevant ticket.

When publishing a spec or ticket, create its file at the appropriate path. When fetching a ticket, read the referenced file.

## Wayfinding

- Map: `.scratch/<effort>/map.md`, containing Notes, Decisions-so-far, and Fog.
- Child tickets: `.scratch/<effort>/issues/<NN>-<slug>.md`.
- Type: `research`, `prototype`, `grilling`, or `task`.
- Lifecycle: `Status: open`, `Status: claimed`, or `Status: resolved`.
- Dependencies: `Blocked by: NN, NN`; a ticket is unblocked when all dependencies are resolved.
- Frontier: choose the lowest-numbered open, unblocked, unclaimed ticket.
- Claim: save `Status: claimed` before starting work.
- Resolve: append the result under `## Answer`, set `Status: resolved`, and add a summary and ticket link to the map's Decisions-so-far.

Wayfinding lifecycle statuses are separate from implementation-ticket triage statuses.
