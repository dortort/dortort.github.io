---
title: "Monorepo vs Multi-Repo: Why AI Agents Tip the Scale"
date: 2026-05-20
description: "AI coding agents optimize for full-codebase context, atomic changes, and connected dependency graphs — properties that monorepo provides by default."
tags:
  - AI
  - Agentic AI
  - Architecture
  - Developer Experience
---

The monorepo vs multi-repo debate ran for over a decade without a clear winner. That wasn't because engineers couldn't agree — it was because both models offered genuine advantages under different constraints. A 50-person startup with three services and a 10,000-person company with hundreds of microservices faced different problems. The right repository structure depended on team size, deployment cadence, ownership models, and tooling maturity.

That calculus has changed. AI coding agents, code generation, and agentic development workflows have shifted what matters in a repository model. The repository model that gives AI coding agents maximum context, atomic cross-cutting changes, and transactional execution now has a clear advantage.

That model is monorepo.

## The old tradeoffs were real

Before AI coding agents became mainstream, the monorepo vs multi-repo decision optimized for human workflows: how engineers navigate code, how teams draw ownership lines, how CI/CD pipelines scale, and how releases ship.

Monorepo gave you atomic cross-service changes, a single dependency graph, unified CI/CD, and zero version skew between internal libraries. The cost was large clone sizes, slower CI without build caching, complex permission models, and the need for specialized tooling like [Bazel](https://bazel.build/), [Pants](https://www.pantsbuild.org/), [Nx](https://nx.dev/), or [Buck2](https://buck2.build/) to keep builds fast.

Multi-repo gave you strong ownership boundaries, independent versioning, smaller checkouts, faster isolated builds, and a reduced blast radius when something broke. The cost was painful cross-repo changes, dependency drift between services, version coordination overhead, and friction around shared API contracts.

Both sets of tradeoffs were real. Google chose monorepo and invested heavily in [custom tooling](https://dl.acm.org/doi/10.1145/2854146) — Piper for source control, CitC for cloud workspaces, Blaze for builds — to make it work across billions of lines of code. Many companies chose multi-repo and built coordination processes around the seams.

Neither side was wrong. The inputs just hadn't changed yet.

## AI changed the optimization function

AI coding agents shifted three assumptions that the old tradeoff analysis depended on.

**Context bandwidth is now the binding constraint.** AI coding agents generate better code when they can see the full picture: type definitions, call sites, test cases, dependency relationships, and usage patterns across the entire codebase. A repository boundary is a context wall. Every wall degrades the quality of AI-generated output.

**Cross-cutting change cost dropped toward zero.** Renaming an interface, updating every call site, fixing the downstream tests, and adjusting the documentation used to be a multi-day coordination effort across repositories. An AI coding agent in a monorepo does this in a single pass. In a multi-repo setup, the same change still requires coordinated PRs, version bumps, release ordering, and compatibility windows.

**Dependency reasoning became automated.** Engineers used to maintain mental models of how services depended on each other. AI coding agents read the actual dependency graph. The bigger and more connected that graph is, the more accurately the agent reasons about change impact. Fragmenting the graph across repositories forces the agent to guess at boundaries it can't see.

These three shifts don't make multi-repo impossible. They make it more expensive relative to monorepo than it used to be.

## Context is the new bottleneck

Consider a concrete scenario: you ask an AI coding agent to rename a field in a shared protobuf definition that five services consume. In a monorepo, the agent sees the `.proto` file, the generated bindings, and every service's handler code. It renames the field, regenerates the bindings, and updates all five consumers in one pass. In a multi-repo setup, the agent can only see the proto definition repo. It renames the field there, but the five consuming services live in separate repositories. Each one breaks on its next build, and someone has to coordinate the updates manually.

This failure mode generalizes. When an AI coding agent working in service A needs to understand how service B consumes a shared library, it either has access to that code or it doesn't. In a multi-repo world, it usually doesn't. The agent falls back to stub assumptions, infers API behavior from incomplete type hints, or generates code that works in isolation but breaks at integration time.

Anyone who has used an AI coding agent across a multi-repo project has seen some version of this: the agent generates a change that compiles locally but violates a contract defined in another repository. The fix is the same every time — give the agent more context. Monorepo gives it all the context by default.

## Cross-cutting changes went from expensive to cheap

AI coding agents are most effective at cross-cutting work: refactoring a shared interface and updating every consumer, migrating a dependency and fixing all downstream breakage, or propagating a type change across service boundaries.

In a monorepo, these are atomic operations. The agent modifies the source, updates every call site, adjusts the tests, and produces a single commit that either passes CI or doesn't. No partial state. No version skew. No window where service A runs the new interface while service B still expects the old one.

In a multi-repo setup, the same change becomes a distributed transaction:

1. Make the change in the library repo and publish a new version
2. Open PRs in each consuming repo to update the dependency
3. Ensure all consuming repos merge in the right order
4. Handle the window where some services use the old version and others use the new one
5. Coordinate rollback if any step fails

This is fragile enough when humans manage it. AI coding agents currently lack standardized tooling for orchestrating changes across multiple repositories as a single logical transaction. The agent either has one graph to work with or it doesn't. Monorepo gives it the one graph.

## AI erodes monorepo's historical costs

The standard objections to monorepo were always about operational friction: the repo is too big to clone, the build is too slow, navigation is too hard, onboarding takes too long.

AI coding agents are wearing each of these down.

| Historical objection | Current state |
|---|---|
| "The codebase is too large to navigate" | AI coding agents search and reason over million-line codebases — [Cursor](https://cursor.com/) indexes the full workspace, [Sourcegraph Cody](https://sourcegraph.com/cody) builds semantic search across entire codebases |
| "Refactors across the repo are risky" | AI coding agents execute refactors with full graph awareness and test validation |
| "The dependency graph is too complex" | AI coding agents map dependency graphs automatically |
| "Build configuration is a burden" | AI coding agents generate and maintain build files (tools like [Gazelle](https://github.com/bazelbuild/bazel-gazelle) already do rule generation for Bazel; AI extends this further) |
| "Onboarding new engineers takes weeks" | AI coding agents explain repo structure, trace code paths, and answer architecture questions on demand |

The infrastructure side has caught up too. [Git sparse-checkout](https://git-scm.com/docs/git-sparse-checkout) and [Scalar](https://git-scm.com/docs/scalar) (originally VFS for Git, [developed by Microsoft for the Windows repo](https://devblogs.microsoft.com/devops/introducing-scalar/)) limit your working set to only the files you need. Remote build execution through Bazel or similar systems means local machine specs matter less. Graph-aware CI systems like Nx and [Turborepo](https://turbo.build/) only rebuild and retest what changed.

The operational costs that once justified multi-repo as "the simpler choice" are shrinking. The context costs of multi-repo are growing as AI coding agents become a larger part of the development workflow.

## Toolchains assume a single workspace

Look at how the current generation of AI coding tools is built. IDE-integrated agents like [Cursor](https://cursor.com/) and [GitHub Copilot](https://github.com/features/copilot) index the open workspace for context. CLI-based agents like [Claude Code](https://github.com/anthropics/claude-code) and [Aider](https://aider.chat/) operate within a single repository directory. Code intelligence platforms like [Sourcegraph Cody](https://sourcegraph.com/cody) can bridge repositories, but doing so requires explicit multi-repo configuration that most teams skip.

The default for all of these tools is: open a repo, index it, reason over it as one unit. Multi-repo splits the graph across repository boundaries, and each tool either needs custom bridging (which most teams don't build) or operates with a partial view of the system. The tools that gain traction tend to assume a single-workspace setup, because that's where they produce the best results with the least configuration.

## Agentic workflows need transactional boundaries

Agentic coding, where an AI coding agent executes a multi-step plan autonomously, follows a consistent loop: analyze the codebase, make a set of coordinated changes, update affected tests, validate CI, and commit.

That loop assumes a single transaction boundary. The agent needs write access to every file involved in the change, the ability to update dependents in the same commit, and a single CI run that validates the entire change set.

Monorepo provides this naturally. One repo, one commit boundary, one CI pipeline.

Multi-repo forces a distributed transaction: changes span multiple repositories, each with its own commit history, CI pipeline, and merge process. Distributed transactions are hard to get right even with purpose-built coordination infrastructure. AI coding agents don't have that infrastructure today, and bolting it on adds complexity that monorepo avoids entirely.

## The counterarguments, honestly

**"Monorepos don't scale."** They do, but they require investment. Google's monorepo holds roughly two billion lines of code, used by more than 25,000 developers, managed by custom tooling built over a decade ([Potvin & Levenberg, 2016](https://dl.acm.org/doi/10.1145/2854146)). Not every company can replicate that. But for most organizations, sparse-checkout, Bazel or Nx, and remote execution handle the scaling problem. The scaling objection is about tooling investment, not an inherent architectural limit.

**"Teams need isolation."** Isolation is legitimate, but repository boundaries are one enforcement mechanism, not the only one. [`CODEOWNERS`](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) files, [path-based code ownership](https://docs.gitlab.com/user/project/codeowners/), protected directory policies, and build-graph enforcement all provide isolation within a monorepo. The question is whether the isolation benefit of separate repos outweighs the context cost. For most internal teams, it doesn't.

**"Independent releases are easier in multi-repo."** They are, for now. But AI-assisted release tooling is closing the gap: automated version propagation, dependency-update PRs, compatibility verification, and semantic release pipelines all reduce the coordination overhead of monorepo releases. This objection is valid but weakening.

## When multi-repo still wins

Multi-repo remains the right choice in specific situations:

- **Legal or compliance separation**: when regulations require distinct codebases for different business units or jurisdictions
- **Open-source boundary management**: when public-facing OSS projects need their own contribution workflows and licensing
- **Vendor or third-party boundaries**: when components are owned by external parties with their own release cycles
- **Security isolation mandates**: when access controls must be enforced at the repository level for regulatory reasons
- **Fundamentally divergent tech stacks**: when projects share no dependencies, no interfaces, and no team overlap

These are structural constraints, not optimization preferences. If you hit one, multi-repo is the pragmatic choice regardless of AI tooling.

## What this means for your next project

If you're starting a new platform or consolidating existing services, default to monorepo. The context advantages for AI-assisted development compound as the codebase grows. Every service, library, and schema in the same repo is another piece of context your AI coding agents can use to generate better code, catch more bugs, and execute larger refactors.

Co-locate services and their shared libraries. Centralize shared schemas, type definitions, and API contracts. Keep tests next to implementations. Adopt a graph-aware build system (Bazel, Nx, Turborepo) early. Enable repository-wide indexing for your AI coding tools.

The monorepo vs multi-repo debate was genuinely balanced when engineers were the only consumers of repository structure. AI coding agents are now a second consumer, and they optimize for different properties: full-codebase context, atomic multi-package changes, and a connected dependency graph.

The repository model that provides these is monorepo. The open question is how fast multi-repo orchestration tooling catches up — and whether it can close the context gap before monorepo becomes the default.
