---
title: "Agentic DevOps Security: Old IAM Failures at New Speed"
date: 2026-08-02
description: "Agentic DevOps security concerns aren't new — they're old IAM failures (least privilege, step-up auth, JIT) agents now exercise at machine speed."
tags:
  - Agentic AI
  - Security
  - DevOps
  - AI
  - AWS
---

I argued previously that agentic AI is reintroducing ClickOps, and I still think that holds. But I made a second claim in that piece I've stopped believing: that least-privilege design is harder for agents than for humans, because you can't predict at design time what actions an agent will decide to take.

That's true as far as it goes. It's also not a fact about agents. It's a fact about how we grant permissions, and it was already true of the humans we granted them to.

Most of the security concerns I hear about agentic DevOps are worth taking seriously. Almost none of them are new. Three come up most: that an agent will exceed its task and use its credentials destructively, that nothing forces a human to approve what it does, and that scoping its access down breaks the cases where it genuinely needs more. Each one is a pre-existing identity and access management failure that agents are now exercising fast enough to make visible.

## The gap between granted and exercised

Least privilege is not recent advice. Saltzer and Schroeder wrote it down in [The Protection of Information in Computer Systems](https://web.mit.edu/Saltzer/www/publications/protection/Basic.html) in 1975: "Every program and every user of the system should operate using the least set of privileges necessary to complete the job." Fifty years of it being obvious.

Microsoft's permissions telemetry shows how that went. In its [2024 state of multicloud risk report](https://www.microsoft.com/en-us/security/blog/2024/05/29/6-insights-from-microsofts-2024-state-of-multicloud-risk-report-to-evolve-your-security-strategy/), just 2% of human and workload identity permissions were used in 2023, and more than 50% of cloud identities had access to all permissions and all resources.

Read those two numbers together. Organizations grant near-total access and then use about a fiftieth of it.

The unused 98% was never safe. It was unexercised. That distinction didn't matter much while the identity holding the permissions was a person, because people work at human speed, hesitate in front of destructive commands, and mostly stay inside the runbook they were given. Permission was granted broadly and used narrowly, and the difference was covered by habit.

An agent has no habits. Give it `AdministratorAccess` and a task, and its action space is the grant, not the runbook.

That's the entire mechanism. Agents did not expand anyone's privileges. They closed the gap between the privileges that were granted and the privileges anyone actually used. Every concern downstream of "the agent might do more than I asked" restates an older one: this identity could always have done more than I asked.

It wasn't a human-identity problem to begin with, either. The same report found workload identities make up 83% of all cloud identities, and that the average organization has three human super identities for every seven workload ones. Non-human principals holding unrestricted access was already the majority case before anyone wired a language model to a cloud API.

The gap persisted because least privilege is a tax paid up front, in friction, by whoever grants the access, and the payoff is an incident that doesn't happen. That is a bad trade for anyone whose quarter is measured in shipped features. So access was granted broadly, on the assumption nobody would use all of it. Nothing ever forced the bill.

## "Human in the loop" is an authentication requirement

The most common ask I hear about agentic pipelines: before the agent does something destructive, a human should approve it.

That's **step-up authentication**. It has been specified and shipped for years.

[NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) requires that every authenticated session carry a definite reauthentication timeout, and recommends no more than 24 hours at AAL2, with a one-hour inactivity timeout. The standard already assumes a session's authentication decays and has to be renewed by a human who is present.

Cloud IAM ships the enforcement primitive. AWS exposes `aws:MultiFactorAuthPresent` and `aws:MultiFactorAuthAge` as [global condition keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html), and AWS's own documentation works the example: allow every EC2 action, then [deny `StopInstances` and `TerminateInstances` whenever MFA is absent](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_examples_ec2_require-mfa.html). Add a statement like this to a policy on the role your agent assumes, and destructive calls fail unless a human completed MFA in the last five minutes:

```json
{
  "Sid": "RequireRecentMFAForDestructiveActions",
  "Effect": "Deny",
  "Action": [
    "ec2:TerminateInstances",
    "rds:DeleteDBInstance",
    "s3:DeleteBucket"
  ],
  "Resource": "*",
  "Condition": {
    "NumericGreaterThanIfExists": {
      "aws:MultiFactorAuthAge": "300"
    }
  }
}
```

The `IfExists` suffix is doing the load-bearing work. `aws:MultiFactorAuthAge` is absent entirely when a request arrives on long-term credentials, and `NumericGreaterThanIfExists` treats an absent key as a match. So the statement denies on stale MFA and on no MFA at all, which is the behavior you want and the reason the plain `NumericGreaterThan` version quietly fails open. AWS documents the same trap for `BoolIfExists` on its own example policy, which is a good indication of how easy it is to write this gate and get it backwards.

The specific policy isn't the point. The point is that "no agent may delete production data unless a human authenticated in the last five minutes" is expressible in the access control language you already run in production. It's a condition key. There is no missing technology here. There is a policy nobody wrote.

## Session approval is not action approval

This is where the concern has real substance, and where I'd push back on my own reassurance.

MFA at the start of a session authenticates a human. It does not authorize an action. Once the agent holds a session credential minted under MFA, it holds a bearer token for your consent: for five minutes under the statement above, or up to 24 hours under the AAL2 ceiling. Everything it does inside that window carries your authentication. That's a human at the start of the loop, not in it.

This one also has an answer, just not from our industry. European payments regulation hit the identical problem: a customer authenticates to their bank, then a transaction executes, and something has to bind the second to the first. [Commission Delegated Regulation (EU) 2018/389](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32018R0389), Article 5, answers it with **dynamic linking**. The authentication code must be specific to the amount and to the payee, and if either changes, the code is invalid. The principle has a name in that industry: what you see is what you sign.

Applied to agents, dynamic linking says don't approve a session and let the agent act inside it. Approve terminating instance `i-0abc123def456`, and let the approval cover that and nothing else. Change the instance ID and the approval fails.

Cloud IAM doesn't offer this. Condition keys gate on whether MFA happened and how recently, not on whether a human saw and consented to this specific call with these specific parameters. That's a genuine gap. It is a gap in porting, not in invention: European banks have been required to work this way since 2019, and the primitive is running in production across an entire regulated industry.

## Standing privilege is the bug, and JIT is the fix

The third objection: some tasks legitimately need elevated access sometimes. You can't scope an identity to the narrow case when the broad case shows up monthly.

Correct, and this is the oldest solved problem of the three. `sudo` was written around 1980 by Bob Coggeshall and Cliff Spencer at SUNY/Buffalo, on a VAX-11/750 running 4.1BSD, and its [design](https://www.sudo.ws/about/history/) is the entire answer. You don't hold root, you're eligible for root. You elevate for one command. The elevation is time-boxed, and when the window expires you authenticate again — current `sudoers` exposes that window as `timestamp_timeout`.

We took that model, moved to cloud infrastructure, and left it behind. The equivalents exist. [Microsoft Entra Privileged Identity Management](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure) distinguishes eligible role assignments from active ones. AWS publishes a [temporary elevated access solution for IAM Identity Center](https://aws.amazon.com/blogs/security/temporary-elevated-access-management-with-iam-identity-center/) you deploy yourself. [Vault issues dynamic credentials with a TTL](https://developer.hashicorp.com/vault/docs/concepts/lease) and revokes them when it expires. Deploying any of them is still the exception.

"The agent might occasionally need broader access" is an argument for eligibility, not for a standing grant. An agent that requests elevation, holds it for one operation, and loses it automatically has a blast radius bounded by that operation. That isn't an agent control. It's `sudo`, applied to the access you were going to grant permanently anyway.

## What's actually new

Two of these concerns don't reduce to unfinished IAM work.

The first is prompt injection, and it's worth being precise about why MFA and least privilege don't touch it. In an injection attack the agent is correctly authenticated and correctly authorized. It uses its own legitimate permissions to take an action a third party induced it to take. Access control asks whether this principal is allowed to do this, correctly answers yes, and the attack succeeds anyway.

That failure has a name older than most of the tooling we'd use against it. Norm Hardy described [the confused deputy](https://dl.acm.org/doi/10.1145/54289.871709) in 1988: a privileged program tricked into misusing its authority on behalf of a caller who lacks it. What's new is the surface. A compiler could be confused about a filename. An agent reading logs, tickets, and pull request descriptions can be confused about anything that reaches its context window.

The known mitigation is authority that travels with the request instead of with the identity: a single-use token authorizing one call with its parameters already fixed, rather than a role the agent holds and can point at anything. That is dynamic linking again, arriving from the other direction. Capability-based systems have modeled it for decades, and almost no production cloud IAM works that way.

The second is attribution. When an agent makes a change, change management frameworks want one human actor and one approving intent. If a human prompted the agent, is the prompt the approval? If the agent acted on its own reading of a metric, who signed off? I wrote about how that breaks audit trails in the ClickOps piece, and I don't have a better answer now than I did then.

## The audit nobody scheduled

Everything else on the list — over-broad credentials, unbounded blast radius, no approval gate on destructive calls, permanent elevated access — is a finding an IAM audit would have produced five years ago. It would have been filed, ranked below the current sprint, and closed as won't fix, because nothing was exercising the permissions we had granted.

Agentic DevOps is that audit, running continuously, at machine speed, against production. It doesn't file a report.

Take the concerns seriously. Just be honest about which decade they're from. Most teams shopping for an agent governance platform need something duller: the condition key, the eligible-instead-of-active role assignment, and the permission grant they never scoped down.
