---
name: writing-code-comments
description: >
  Gates whether a code comment should exist and ensures the ones that stay explain a non-obvious constraint, consequence, mechanism, or pointer rather than restating the code or narrating its history.
  Use ALWAYS before writing or editing a comment in TypeScript or TSX, and when reviewing a diff that adds comments.
  Removes the comment types that clutter the codebase: narration that restates the code, change-history and chat-context notes, both the marked kind ("previously did X", "per PR #123", "AI:") and an unmarked retelling of the investigation behind a line, perishable measurements and current-state stamps ("~20 min build", "currently", "today"), commented-out code, and redundant docstrings.
  Keeps the ones that earn their place: a non-obvious constraint or why, a consequence that is easy to miss, a technical mechanism needed to understand that constraint, or a pointer to context a future reader cannot reconstruct.
  Not for user-facing copy (see writing-user-facing-copy) or commit messages.
---
# Writing code comments

Run this before adding or editing any comment. The default is no comment when the code is self-explanatory; otherwise improve the code first. A comment earns its place only when it tells a future reader something the code itself cannot.

## The gate: one question

Before writing a comment, answer:

**What does a future reader need to know that the code itself doesn't show?**

If the answer is "it restates what the code does", delete it. Rename the variable or extract a function instead.

Ask this of every sentence, not every comment. A comment can start with a real constraint and then run on into sentences that only narrate the implementation or investigation.

A comment worth keeping explains at least one of these:

- **constraint**: something that must remain true
- **consequence**: what breaks or changes if the code is removed or altered
- **mechanism**: a technical fact needed to understand the constraint
- **pointer**: external context a future reader cannot reconstruct from the repo

The goal is not maximum brevity. The goal is the smallest amount of information needed to understand the non-obvious part of the code.

- ✅ // the rate provider returns amounts in minor units; the app uses major units
- ✅ // changing this breaks the cache key used by the lookup layer
- ✅ // WatermelonDB emits the table change inside the write, before the cache clear runs

## Delete these

### Narration that restates the code

- ❌ `// increment the counter` above `counter += 1`
- ❌ `// loop over users` above `for (const user of users)`
- ❌ `// return the result` above `return result`

If a block needs narration to be followed, the fix is smaller private functions and better names, not a comment.

### Change history and chat context

Never record how the code got here. That belongs in the commit message and PR description, where it's attached to the diff and searchable. In the source it's noise that goes stale immediately.

- ❌ `// previously used a Set here, switched to an array for ordering`
- ❌ `// per PR #1234` / `// as discussed` / `// changed because the old way broke`
- ❌ `// AI: generated this helper` / `// agent: refactored`
- ❌ `// TODO(2024-01): remove after the migration` left in long after the migration

Those examples name the history outright, so they are easy to catch. The harder case has no such marker. A comment can retell the investigation in technical language and still be change history.

Preserve the durable fact that the investigation discovered. Leave out the story of how the team found it, when it happened, and which change introduced it.

- ❌ // upsertMany emits one signal per row it writes, and after we noticed excessive recomputes during the launch refresh, we added this debounce
- ✅ // Notify once per write to avoid recomputing after every changed rate

If the underlying mechanism is needed to understand the constraint, keep the mechanism:

- ✅ // WatermelonDB emits the table change inside the write, before the cache clear runs

Then state the consequence when needed:

- ✅ // WatermelonDB emits the table change inside the write, before the cache clear runs, so a consumer can otherwise read a stale cached rate

Ask what must remain true or what breaks if the line is deleted, not how the team discovered that the line was needed.

### Perishable measurements and current-state stamps

Measured timings, counts, and rates rot silently: nothing forces them to update, and a rotted number misleads the next person sizing a timeout or shard count. The same goes for "currently" / "today" hedges when they add no durable information. State the relationship or requirement that the number stood for.

- ❌ `// the Android build takes ~20 min` when the durable fact is that the build is expensive
- ❌ `// jest-expo transform is slow, ~2s per file` instead of "sized past a cold run of the suite"
- ❌ `// no screen currently uses the web date picker` where dropping "currently" states the same fact
- ❌ `// suite was ~20s in June, past 30 by July` because trend narration is change history

Numbers that stay:

- A dated snapshot: `// as of Expo SDK 57, this needs the legacy decorator plugin` (the version makes staleness visible)
- A restated adjacent code literal: `// amounts over the daily cap (see MAX_DAILY below)` beside the constant (it updates with the code)
- A platform constant: `// AsyncStorage has a 6 MB row limit on Android`
- A target or budget: `// Target: entrance animation under 250 ms` (policy, not measurement)
- Cited evidence: `// crash on Hermes with frozen Date, see nozbe/watermelondb#1683` (the link dates it)

### Commented-out code

Delete it; the version history has it if it's needed again. Commented-out code is ambiguous to the next reader, who can't tell whether it's a note, a rollback plan, or an accident.

### Redundant docstrings and type restatements

- ❌ A JSDoc block that repeats the function name in prose: `/** Gets the account by id. */` on `getAccountById`
- ❌ `// string` on an already-typed field
- ❌ Test doc comments (the repo convention is none; the test name says it)

## Keep these

- A **why/constraint** that isn't obvious from the code: a workaround, performance trade-off, spec quirk, ordering requirement, or invariant.
- A **consequence** about what breaks elsewhere: "changing this breaks the cache key", "callers rely on this being sorted", or "not batching these writes triggers a recompute for every changed row".
- A **mechanism** when the technical fact is necessary to understand the why: "Safari does not dispatch this event", or "the provider returns minor units".
- A **pointer** to context a reader cannot reconstruct from the repo: a link to the spec, ticket, issue, or authoritative platform documentation.

Style

Write comments the way you'd write technical documentation: explicit and precise. State the constraint and its consequence so the reader does not have to infer why the code is unusual. Do not include the investigation that led there. Say what needs saying and stop.

- **Be explicit and technical**. Name the actual condition, invariant, value, or consequence. Avoid hints that force the reader to reverse-engineer the reason.
- **Use mostly ASD-STE100 Simplified Technical English.** Use active voice, simple tenses, one idea per sentence, and consistent terms.
- **Let length follow the content.** One line is good when one line fully explains the non-obvious constraint. Use more lines when the constraint genuinely needs more context. Do not shorten a comment merely to make it look concise.
- **No em-dash.** The tell to avoid is the clipped two-part phrase joined by a dash, like // do the thing — it's faster. Use a real connective instead ("because", "so that", "which means", "to avoid").
- **Explain the non-obvious constraint**, not the implementation. The code already shows what an operator, branch, or function does. Explain why it is needed and what depends on it.

For example:

- ❌ // batch these writes
- ✅ // Notify once per write to avoid recomputing after every changed rate
- ❌ // clear the cache
- ✅ // Clear after the batch so a lookup cannot leave a stale rate cached

- **Preserve existing comments when moving or refactoring code**, unless the change makes them wrong. Don't drop an existing why just because you're relocating the function.
- **Match the surrounding density.** Don't add a comment to every line of a file that had none; don't strip a well-commented module bare.

## A practical test for each sentence

For every sentence in a comment, classify it:

- **Constraint:** keep it.
- **Consequence:** keep it.
- **Mechanism:** keep it when it makes the constraint understandable.
- **Pointer:** keep it when the external context is genuinely useful.
- **Narration, history, or implementation restatement:** delete it.

Then compress the remaining sentences into the smallest complete explanation.

When you're tempted to comment

Try, in order: (1) a better name, (2) a smaller function, (3) a type, (4) a clearer abstraction. Reach for a comment only when none of those can carry the non-obvious meaning.