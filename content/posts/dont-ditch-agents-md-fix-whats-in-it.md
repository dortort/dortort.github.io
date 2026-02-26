---
title: "Don't Ditch AGENTS.md — Fix What's In It"
date: 2026-02-24
description: "Research shows AGENTS.md context files reduce coding agent success rates and increase token cost by over 20%. But the problem isn't AGENTS.md itself — it's context bloat. Treating AGENTS.md as a cache for ambiguity resolution and expensive inferences makes AI coding agents faster and cheaper."
tags:
  - AI
  - LLM
  - Context Engineering
  - Developer Experience
  - Agentic AI
aliases:
  - /posts/agents-md-ambiguity-resolver-cost-cache/
---

A recent study evaluated whether repository-level context files actually help coding agents solve tasks. The findings are counterintuitive: both LLM-generated and developer-authored context files tend to reduce success rates while increasing cost.

The paper — ["Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?"](https://arxiv.org/abs/2602.11988) — tested `AGENTS.md` files across two benchmarks: [SWE-bench Lite](https://arxiv.org/abs/2602.11988) and a custom dataset called AGENTbench, covering 138 real tasks across 12 repositories. On SWE-bench Lite with GPT-4o, the no-context baseline resolved 33.5% of tasks. Adding LLM-generated context dropped that to 32%. Developer-written context files performed worst at 29.6%. Across all configurations, context files increased token cost by [over 20%](https://arxiv.org/abs/2602.11988).

The key finding was not that agents ignore these files. Agents follow them. That compliance is the problem: agents dutifully process every instruction, whether it helps with the current task or not.

One exception is telling. When the researchers removed documentation from the repository before running agents, context files became more helpful. Context files filled an information gap that the codebase could no longer fill on its own.

This points to a specific failure mode and a specific fix.

## What belongs in AGENTS.md

An `AGENTS.md` entry is worth its token cost only when it meets one of two conditions:

1. It resolves ambiguity that the repository's code cannot resolve on its own.
2. It caches information that an agent *could* infer, but only at significant token cost.

Everything else is overhead. Think of a well-authored `AGENTS.md` as an index of expensive truths — facts that matter for decision-making and cost real tokens to derive from first principles.

## Ambiguity resolution: telling the agent what the code can't

Large codebases accumulate contradictions. Architectural standards shift over years. Naming conventions drift across teams. APIs get partially migrated. Legacy modules sit alongside their replacements, both actively compiled and tested.

An agent scanning such a codebase can determine what patterns exist, how often each appears, and how recently each was modified. What it cannot determine from code alone is *intent*: which pattern is canonical for new work, which subsystem is deprecated but maintained for backward compatibility, and which module is the target state versus the one being phased out.

Consider a repository containing both `SerializerV1` and `SerializerV2`. Both appear in production code. Both compile. Both have passing tests.

The repository answers: "What works?"

It does not answer: "What should new code use?"

An agent can attempt to infer this. It can examine git history, compare modification recency, analyze commit frequency, and evaluate usage density across modules. But this analysis is token-intensive, requires multiple tool calls, and may still produce the wrong answer. The most-recently-modified module might be `SerializerV1`, because someone just patched a bug in it last week.

Three lines in an `AGENTS.md` collapse that entire inference chain:

```text
Use SerializerV2 for all new features.
SerializerV1 remains only for backward compatibility.
Do not introduce new V1 usage.
```

This is not restating what the code already shows. It provides the one piece of information the code structurally cannot encode: what the team *decided*.

## Cost caching: precomputing expensive inferences

Caching has a simple validity test: retrieving the cached value must be cheaper than recomputing it. The same test applies to `AGENTS.md`.

If an agent can answer a question with a single file read or one `grep`, that answer does not belong in `AGENTS.md`. The "cache miss" is already cheap. But when the agent would need to scan dozens of modules, trace migration boundaries, run test suites, or reconstruct build dependency graphs, a short declarative statement saves tokens on every task.

High-value cached information tends to fall into a few categories:

- **Canonical patterns**: "New API handlers use `HandlerV2`"
- **Migration boundaries**: "Auth is mid-migration to AuthV2; V1 remains for `/legacy/*` endpoints only"
- **Social conventions**: "All SQL queries go through the query builder, even though raw queries compile fine"
- **Build and test entry points**: "Fast validation: `make test-unit`; full validation: `make test`"
- **Code generation triggers**: "Modifying `schemas/*` requires running `make generate`"
- **Authoritative examples**: "Payment flow reference implementation: `src/payments/processor_v2.py`"

None of these are impossible to discover, but the discovery cost recurs on every task. In Infrastructure as Code specifically, documenting [OOP-style module design patterns](/posts/stop-scripting-start-architecting-terraform-oop) helps agents understand which implementations are canonical versus legacy, reducing exploration cost significantly.

## What does not belong

The paper's finding that context files increase token cost without improving success rates is consistent with a specific failure mode: **context bloat**. When `AGENTS.md` contains information the agent can already access cheaply, it pays the token cost of reading the file without gaining any decision leverage.

Low-value entries include:

- Directory walkthroughs (an agent can run `tree` or `ls`)
- Content duplicated from README files already in the repository
- Broad style-guide prose (belongs in a linter config or a dedicated document, not in agent context)
- Narrative architecture explanations that restate what the code structure already communicates
- Examples the agent could locate with a single `grep`

Each of these adds tokens to every agent interaction while providing information the agent could obtain in one or two tool calls. The net effect is cost without leverage.

## A two-question filter

Every line in `AGENTS.md` should pass at least one of two tests:

**Ambiguity test**: Does this resolve a case where multiple valid implementations exist in the codebase, and the code alone does not indicate which one is preferred?

**Cost test**: Would an agent need significant exploration — multiple file reads, git history analysis, or cross-module tracing — to reliably infer this?

If the answer to both is no, the line is adding cost without adding signal. Remove it.

## A minimal template

Applying this filter produces something like:

```markdown
# AGENTS.md

## Decision rules
- Use X for new features; Y is legacy-only
- Do not copy patterns from /legacy/*
- New APIs must use HandlerV2

## Repository conventions
- Fast validation: make test-unit
- Full validation: make test
- If modifying schemas/*, run make generate
- Use uv for Python commands

## Migration status
- Auth system is mid-migration to AuthV2
- V1 remains for endpoints under /legacy/* only

## Canonical references
- Payment flow: src/payments/processor_v2.py
- Error handling: src/common/errors.py
```

Every entry either resolves an ambiguity or caches an expensive inference.

## Treating AGENTS.md as a performance artifact

Since every instruction in `AGENTS.md` triggers additional tool calls and reasoning, the file is a performance-sensitive artifact. The design criteria follow directly:

- **Signal-to-token ratio**: every line must carry decision-relevant information
- **Stability**: entries should change infrequently, like well-designed cache keys
- **Decision leverage**: prioritize entries that change what the agent *does*, not just what it *knows*
- **No redundancy**: if the information exists elsewhere in the repository in an easily accessible form, do not duplicate it here

## Cache invalidation: when entries go stale

The cache metaphor carries one more implication. Caches go stale, and so do `AGENTS.md` entries. When a migration completes, the boundary note becomes misleading. When a convention changes, the old directive actively harms the agent's output. A stale entry is worse than a missing one — it resolves ambiguity in the wrong direction.

This means `AGENTS.md` needs a maintenance discipline: review it when migrations land, when conventions change, and when new modules replace old ones. If an entry describes a state that no longer exists, remove it. The cost of a stale cache entry is not zero — it is negative, because the agent will follow the outdated instruction with the same diligence it applies to current ones.

## Where this leads

`AGENTS.md` should not describe everything an agent can observe. It should describe what an agent cannot cheaply determine on its own. Filter every entry through the ambiguity and cost tests, keep the file short, and maintain it like the cache it is.

The [research](https://arxiv.org/abs/2602.11988) confirms the stakes: agents follow instructions faithfully. The question is whether those instructions are worth the tokens they consume.

---

*Based on ["Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?"](https://arxiv.org/abs/2602.11988) (arXiv:2602.11988v1).*