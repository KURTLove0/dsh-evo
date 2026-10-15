# Agent Note: Responsive conversation model switching

Status: implemented
Archived: 2026-10-15

English | [中文](2026-10-15-responsive-conversation-model-switch.zh.md)

## Problem

Selecting a native CLI model can take several seconds because the Host asks the runtime for exact model metadata before accepting the selection. The composer menu remained open and displayed the previous model for that entire interval, so a valid click looked ineffective. Prompt submission also remained available while the Host still owned the previous selection, allowing a message submitted during validation to use the model the UI was replacing.

## Decision

`ModelDirectory.select()` publishes the requested selection with `status: selecting` before calling `session.selectModel`. The composer trigger therefore reflects the click immediately and the menu closes. `ModelDirectoryResolver` raises a localized composer block for the selecting state, preventing prompt submission until the Host response establishes which model the next request will use.

An accepted response replaces the optimistic value with the Host's complete selection, including a resolved default reasoning effort. A rejected response restores the previous current and routability values before exposing the error. The existing generation rule still makes a newer load or selection authoritative over a late response.

## Alternatives considered

**Leave the old model visible and add a spinner.** Rejected because it still represents a completed click as unchanged state, and it does not close the prompt-submission race.

**Accept the selection in the Host before exact-model validation.** Rejected because invalid reasoning efforts and model capabilities must fail before the session reports the target as selected.

## Consequences

Model changes are visible immediately even when a local runtime is slow to answer, while prompts cannot enter the old route during validation. A failed change briefly displays the requested model, then returns to the prior selection and announces the Host diagnostic. Component tests pin immediate menu closure, directory tests pin reconciliation and rollback, and the browser-plugin test pins the temporary composer block.
