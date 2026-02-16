# Planned Updates

This file is the single source for planned enhancements.

## Planned Enhancement: Sublist Updates

Goal:

- Support controlled updates to sublist line values from query results.

Design direction:

- Keep current body-field alias model for body updates.
- Introduce an explicit sublist alias contract for line-level targeting.
- Add guardrails for line-key matching and duplicate-line ambiguity.

Status:

- Not implemented.

## Planned Enhancement: Action-Driven Operations

Goal:

- Add optional create/delete operations driven by query output.

Design direction:

- Require explicit action semantics (`update`, `create`, `delete`) in query output.
- Require allowlist-based record type controls for non-update actions.
- Add dry-run and approval gating before non-update actions can execute.

Status:

- Not implemented.

## Documentation Rule

- Keep future-roadmap content in this file only.
- Use other docs for current behavior, setup, and operations.
