# @deepseek-ai/dsh-client-ui-business-workflow

English | [中文](README.zh.md)

The sidebar opens an independent workspace workflow page; conversation headers contain no workflow module. New workflow expands an inline create form requiring a workspace, name, and business description; collapsing it retains unfinished fields. With an empty directory the form opens automatically. The directory supports case-insensitive name search, workspace filtering, a reset action for empty results, and latest-run status badges. It reads the durable business API independently of conversation selection. Legacy records remain accessible through their conversation links and compact Chat cards.

The directory and detail share a split view that stacks by available page width. Segmented design, run, and verification tabs support arrow keys, Home, and End. Collapsing creation returns focus to its entry. Action groups emphasize saving edited drafts or publishing saved ones; draft status is distinct from execution success. Theme tokens, visible focus, reduced-motion and high-contrast styles apply throughout.

The design tab places a collapsible business requirement above the canvas and a selected-node inspector beside it on wide screens. Acceptance cases use labeled name, sample-input JSON, and assertion controls. The editor also edits node instructions, presets, dependencies, input sources, and final output bindings. Node cards show their order, kind, and status; selection works by pointer or keyboard. Nodes support dragging, arrow-key and button moves, zoom, fit-to-canvas, scrolling, and automatic layout; movement buttons expand under Node position. Viewport zoom does not change saved positions. Dependencies remain the authoritative edges; editing display names or positions preserves node identities. Local drafts survive page remounts, retain their base revision, and cannot silently overwrite a concurrent save. Publish requires a saved, valid draft. AI generation presents a separate candidate for explicit adoption.

Run and verification tabs separate execution selection from the selected run details, showing their fixed publication graph, resolved input values, executed prompt, model/provider, tools, working directory, timestamps, outputs, errors, and execution-session links. Human confirmation and cancellation call deterministic Remote commands. Verification assertions remain separate from execution success. Reruns create new identities and execute all nodes again. Invalid run-input JSON blocks submission across tab changes; unmounting an editor releases its validation state. Host notifications and reconnect trigger authoritative snapshot refreshes through the React-free runtime owner.

## Model Experience

Only AI generation and Agent nodes invoke a model. Generation receives the business request, current saved draft, supported definition schema, and authorized presets with tools disabled. Each Agent node receives its business background and explicitly bound inputs in a fresh child session. Saving, publishing, selecting records, and human decisions do not create conversation turns.

#### KV Cache effect

Independent execution sessions do not append to the user's conversation. Each fresh child has its own request prefix and history.

## Known Limitations and Deferred Work

- The canvas uses the existing SVG renderer and deterministic layout; React Flow and Dagre integration requires installing those dependencies.
- Business objectives, data fields, constraints, and source bindings use form controls. Sample inputs and advanced definitions use labeled JSON editors. The server validates all fields and references before publication.
- The complete directory and selected history are fetched as snapshots; large-output pagination and incremental cursor delivery are deferred.
