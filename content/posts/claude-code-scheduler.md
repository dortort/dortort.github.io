---
title: "Closing the automation gap in Claude Code"
date: 2026-04-07
description: "Claude Code's built-in scheduler requires the Desktop app running and behaves differently from interactive sessions. claude-code-scheduler bridges Claude Code to launchd and crontab for persistent, observable, stateful task automation that runs whether you're at your desk or not."
tags:
  - AI
  - Agentic AI
  - Developer Experience
  - Automation
  - DevOps
---

Claude Code Desktop introduced [scheduled tasks](https://docs.anthropic.com/en/docs/claude-code/overview) last year, and I immediately started using them. Morning standup prep that summarized yesterday's commits, end-of-day PR digests, a weekly dependency audit — all running on a timer without me touching anything. For simple recurring prompts, it worked.

Then I tried to build something more involved. I wanted a task that ran every morning before I started work — reviewing open PRs, summarizing what changed overnight, and flagging anything that needed my attention. A straightforward cron job, except the worker is Claude instead of a bash script.

Two problems surfaced quickly. First, the built-in scheduler requires the Desktop app to be running. The app is resource-heavy, and keeping it open around the clock just to service a few scheduled tasks felt wrong — I didn't want to dedicate those resources to a process I wasn't actively using. Second, the scheduled execution environment is sandboxed differently from an interactive session. Prompts and skills that worked fine when I ran them manually would behave inconsistently — or fail outright — when triggered on a schedule. I'd spend time debugging differences between the two environments instead of building the actual automation. I wasn't looking for a prompt scheduler anymore. I was looking for a job runner that executed Claude Code the same way I did.

So I built [claude-code-scheduler](https://github.com/dortort/claude-code-scheduler).

## Binding Claude Code to native OS schedulers

The core design decision in `claude-code-scheduler` is to delegate all scheduling to the OS. On macOS, tasks register with `launchd`. On Linux, they register with `crontab`. The plugin has no daemon and no runtime scheduler of its own.

This has a few direct consequences.

**Tasks persist across reboots.** Because `launchd` and `crontab` are system services, registered tasks survive application restarts, system reboots, and log-outs. If you schedule a task for `0 3 * * *`, it runs at 03:00 regardless of whether Claude Code Desktop is open.

**Scheduling semantics are deterministic.** Cron expressions behave exactly as they do everywhere else — no abstraction layer adds jitter, batching, or "approximate" windows. The plugin validates cron expressions at registration time using [croner](https://github.com/hexagon/croner) and converts them to human-readable descriptions with [cronstrue](https://github.com/bradymholt/cRonstrue) so you can confirm what you've configured.

**Natural language works too.** You can say "every weekday at 9am" or "daily at 5pm" and the plugin translates it into a cron expression. But the cron expression is what gets registered — the natural language is a convenience, not the source of truth.

The implementation is split into platform-specific modules: `schedulers/darwin.ts` generates `launchd` plist files, and `schedulers/linux.ts` manages crontab entries. A shared executor (`cli/executor.ts`) handles the actual invocation of Claude Code sessions when the OS fires the trigger.

## Configuration as code

Tasks live in JSON config files:

- **Global**: `~/.claude/schedules.json`
- **Project-local**: `<project>/.claude/schedules.json`

A task definition includes a name, prompt, schedule (cron or natural language), execution settings, and optional memory configuration. Since the config is a plain JSON file, you can commit project-level schedules to Git, review changes in pull requests, and reproduce task configurations across machines.

Global config takes precedence on ID collisions — and project-level configs cannot set `skipPermissions`, which prevents a cloned repo from silently escalating what scheduled tasks are allowed to do.

## Observability that's actually useful

Every execution writes a JSONL record to the history log. Each entry includes a timestamp, exit status, task metadata, and the project it ran against. You can filter history by status, task name, or project — the same kind of introspection you'd expect from a CI system.

Stdout and stderr from each run are captured separately, with rotation and cleanup policies so logs don't grow unbounded. When a nightly task starts failing, I can pull up `scheduler:logs` and see exactly what Claude produced, what errored, and when.

This matters because the failure mode of unobservable automation isn't "it breaks loudly." It's "it silently does the wrong thing for weeks."

## Run-to-run memory

The feature I reach for most on scheduled tasks is context injection. A task can optionally take its output from the previous run and inject it into the next prompt.

This turns a stateless recurring prompt into a stateful process. A nightly repository analysis can compare today's findings against yesterday's. A documentation generator can carry forward its running summary and only process new commits. A refactoring task can track which files it's already touched.

The mental model shifts: you're not scheduling isolated prompts anymore. You're composing a process that evolves over time, where each run has access to what the previous run learned.

## Git worktree isolation

Each task can optionally execute in an isolated [Git worktree](https://git-scm.com/docs/git-worktree). The plugin manages the worktree lifecycle — creation before the run, cleanup after — through `vcs/index.ts`.

This solves a practical problem: if a scheduled task modifies files (refactoring, documentation updates, auto-fixes), you don't want it stomping on your working directory. Worktree isolation means the task operates on its own copy of the repository. It can commit, branch, and modify files without touching your main checkout.

It also enables safe parallel execution. Two tasks targeting the same repo can run concurrently in separate worktrees without conflicts.

## Security boundaries

Unattended AI execution is a different trust context than interactive use. You're not watching every command; the task runs at 3 AM and you review the results in the morning.

The plugin enforces several safeguards:

- **Environment variable blocklisting** prevents tasks from accessing sensitive env vars
- **Sensitive file detection** flags operations that touch credential files or secrets
- **Shell escaping** sanitizes all inputs that flow into shell commands
- **Trust boundary enforcement** restricts what project-level configs can do — specifically, the `skipPermissions` flag is reserved for global config only

These aren't theoretical precautions. If you're scheduling tasks that write code, create branches, or modify configuration, the surface area for unintended side effects is real.

## The CLI surface

The plugin installs in one command and exposes everything through Claude Code's slash command system:

```bash
claude plugin install @dortort/scheduler
```

The core commands — `/scheduler:add`, `/scheduler:list`, `/scheduler:run`, `/scheduler:logs`, `/scheduler:history` — cover the full lifecycle from creating a task to reviewing its execution history. There are ten commands total, including `/scheduler:edit`, `/scheduler:enable`, `/scheduler:disable`, `/scheduler:remove`, and `/scheduler:status` for ongoing management. Everything runs through the CLI, so you can script it and integrate it into existing shell workflows.

## What this makes possible

With persistence, observability, security, and state all in place, the question shifts from "can I schedule this?" to "what should I schedule?" Claude stops being a tool you prompt and starts being a process you run.

**Nightly repository analysis.** Schedule a task that scans the repo every night, detects issues (stale dependencies, type errors, test coverage gaps), and writes a summary. With memory injection, each run compares against the previous night's findings and only surfaces what's new.

**Incremental documentation.** A task that runs after each day's commits, analyzes the changes, updates relevant docs, and carries forward its running context. Over a week, it builds up a changelog-style summary that's grounded in actual code changes.

**Automated refactoring in isolation.** A weekly task that evaluates code quality metrics, applies targeted transformations in a worktree, commits the results to a branch, and logs what it changed. You review the branch on Monday morning — the task did the mechanical work over the weekend.

**Convergent analysis.** Using memory injection across multiple runs, a task can iteratively refine its output. First pass: broad analysis. Second pass: focused on areas the first pass flagged. Third pass: verification. Each run builds on the previous one, converging toward a thorough result.

## Where it fits

Claude Code Desktop's scheduler and `claude-code-scheduler` aren't competing — they cover different parts of the spectrum.

The built-in scheduler is optimized for immediacy. It runs in your active session, shows results in the UI, and works best for tasks you want to see and interact with. It's the right tool when you're at your desk and want Claude to check on something periodically.

`claude-code-scheduler` is optimized for reliability. Tasks run whether or not you're around. Every execution is logged. State carries across runs. The OS guarantees the schedule. It's the right tool when you want Claude to do work in the background, overnight, or as part of a repeatable workflow.

The gap between "interactive prompt scheduler" and "background automation infrastructure" is exactly the gap this plugin fills. Scheduling is a solved problem at the OS level — `launchd` and `crontab` have been doing this for decades. What was missing was a clean binding between those schedulers and Claude Code's execution model. That's what `claude-code-scheduler` provides: not a new scheduler, but a bridge between an AI coding agent and the scheduling infrastructure that already exists on every developer's machine.
