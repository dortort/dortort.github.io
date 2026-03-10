---
title: "Beyond terraform_remote_state: five ways to share data across Terraform configurations"
date: 2026-03-09
description: "Most teams start with terraform_remote_state, hit its limits, then layer on intermediary stores. The simplest answer is to stop sharing data entirely and share naming rules instead."
aliases:
  - /posts/terraform-workspace-sharing/
tags:
  - Terraform
  - Infrastructure as Code
  - DevOps
  - AWS
---

Every team that splits Terraform into multiple root configurations hits the same wall: configuration A creates a VPC, and configuration B needs the VPC ID. The question isn't whether you need cross-configuration data sharing. It's which approach scales without becoming a maintenance problem.

A note on terminology: Terraform Cloud calls these "workspaces." In open-source Terraform, the equivalent concept is separate root modules, each with their own state. This article uses "configuration" to mean a root module with its own state file, regardless of platform. When discussing Terraform Cloud specifically, I use "workspace" because that's the platform's term.

I've run through most of the common patterns across dozens of production Terraform configurations. The progression was predictable: start with `terraform_remote_state`, hit its limits, layer on intermediary stores, then realize the simplest answer was to stop sharing data entirely and share naming rules instead.

Here's what each approach looks like in practice, why [HashiCorp's own documentation](https://developer.hashicorp.com/terraform/language/state/remote-state-data) warns against the most popular option, and why deterministic naming turned out to be the answer I should have started with.

## terraform_remote_state: the obvious first choice

`terraform_remote_state` is the first thing most teams reach for. It reads output values from another configuration's state file:

```hcl
data "terraform_remote_state" "network" {
  backend = "s3"
  config = {
    bucket = "my-terraform-state"
    key    = "network/terraform.tfstate"
    region = "us-east-1"
  }
}

resource "aws_instance" "app" {
  subnet_id = data.terraform_remote_state.network.outputs.subnet_id
}
```

It works. It ships with Terraform. And HashiCorp explicitly recommends against it.

The [official documentation](https://developer.hashicorp.com/terraform/language/state/remote-state-data) states: "We recommend explicitly publishing data for external consumption to a separate location instead of accessing it via remote state." The reasoning is straightforward. Although `terraform_remote_state` only exposes output values, the consumer must have read access to the entire state snapshot. State snapshots routinely contain database passwords, private keys, and API tokens.

The coupling problem is just as bad. The consuming configuration needs the exact backend details of the producer: the S3 bucket, the key path, the region. Change any of these and every consumer breaks. Consumers also need IAM permissions to the producer's state bucket, and the number of cross-account access policies grows with every new cross-reference between configurations.

With three configurations, this is manageable. With thirty, it's a permissions spreadsheet that nobody wants to maintain.

`terraform_remote_state` is fine for prototyping or small teams with a handful of configurations and nothing sensitive in state. Beyond that, you end up with a `data.tf` file full of remote state blocks that nobody wants to touch, each one a hardcoded dependency on another team's storage layout.

## Provider data sources: query the cloud directly

Instead of reading state, you can look up resources through the cloud provider's API:

```hcl
data "aws_vpc" "main" {
  tags = {
    Name = "production-vpc"
  }
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.id]
  }
  tags = {
    Tier = "private"
  }
}

resource "aws_instance" "app" {
  subnet_id = data.aws_subnets.private.ids[0]
}
```

This is what HashiCorp's [module composition documentation](https://developer.hashicorp.com/terraform/language/modules/develop/composition) recommends. The consuming configuration doesn't need access to the producer's state backend, file layout, or even knowledge of whether Terraform created the resource. It queries the cloud API directly.

No cross-configuration coupling. No state file access requirements. Works with resources created by any tool — Terraform, CloudFormation, the console, or a script someone ran two years ago and forgot about. The cloud provider's API is a more natural integration boundary than a state file because it's the system of record. You're querying the actual resource, not a snapshot of what Terraform last wrote.

The downsides are real. You need a reliable way to identify the resource you're looking up. Tags work until someone changes a tag. Names work until someone renames something. Filters can match multiple resources unexpectedly, and `terraform plan` gives you a confusing error when that happens. Data source lookups also hit the cloud API on every plan, adding latency and counting against rate limits in large configurations.

There's a bootstrapping problem too. Data sources fail if the target resource doesn't exist yet. If configuration A creates the VPC and configuration B looks it up, you need to apply A first. That ordering dependency lives in your head, in a wiki, or in a CI/CD pipeline. Terraform doesn't track it for you.

## tfe_outputs: the Terraform Cloud answer

Provider data sources work for any Terraform setup. If you're on Terraform Cloud or HCP Terraform, there's a platform-specific option worth knowing about.

The [`tfe_outputs`](https://registry.terraform.io/providers/hashicorp/tfe/latest/docs/data-sources/outputs) data source reads another workspace's outputs without granting access to the full state:

```hcl
data "tfe_outputs" "network" {
  organization = "my-org"
  workspace    = "network-production"
}

resource "aws_instance" "app" {
  subnet_id = data.tfe_outputs.network.values.subnet_id
}
```

This solves the security problem that makes `terraform_remote_state` dangerous. `tfe_outputs` only exposes output values, and access is controlled through Terraform Cloud's workspace permissions rather than backend storage IAM.

The limitation: it only works on Terraform Cloud and HCP Terraform. Teams running Terraform with an S3 or GCS backend can't use it. It also still couples workspaces by name — renaming a workspace breaks every consumer.

If you're already on Terraform Cloud, `tfe_outputs` is the right choice within that ecosystem.

## SSM Parameter Store and Consul KV: external intermediaries

AWS teams often land on [SSM Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html) as the "separate location" that HashiCorp recommends. The producing configuration writes values to SSM; the consuming configuration reads them:

```hcl
# Producer
resource "aws_ssm_parameter" "subnet_id" {
  name  = "/infrastructure/production/subnet_id"
  type  = "String"
  value = aws_subnet.private.id
}

# Consumer
data "aws_ssm_parameter" "subnet_id" {
  name = "/infrastructure/production/subnet_id"
}

resource "aws_instance" "app" {
  subnet_id = data.aws_ssm_parameter.subnet_id.value
}
```

SSM gives you fine-grained IAM access control, encryption via KMS, an audit trail through CloudTrail, and a store that any tool can read. Application code, CI/CD pipelines, and configuration management systems can all pull from the same parameters.

The cost is an extra resource per shared value. Every VPC ID, subnet ID, or endpoint URL becomes an `aws_ssm_parameter` resource in the producer and a data source in the consumer. A configuration that exports 20 values means 20 additional resources to manage, though teams often reduce this by using `for_each` over a map of outputs. Cross-account reads require additional IAM configuration, and you need a consistent path hierarchy (`/infrastructure/{env}/{region}/{resource}`) that itself becomes a coordination problem.

HashiCorp's documentation suggests [Consul KV](https://developer.hashicorp.com/consul/docs/automate/kv) as an alternative, using `consul_keys` resources and data sources in the same producer/consumer pattern. If you're already running Consul, the KV store is a natural fit. If you're not, deploying a Consul cluster (running servers, configuring ACLs, maintaining availability) to share VPC IDs between Terraform configurations is overhead that doesn't justify the use case.

## The contract module pattern: clever but not worth it

Some teams try to solve the producer/consumer problem with a "contract module" or "interface module," a single shared module with a `create` flag that switches between resource creation and data source lookup:

```hcl
# The module exposes one interface for both modes
module "vpc" {
  source = "./modules/vpc-contract"
  create = false  # lookup mode

  name        = "production-vpc"
  environment = "production"
}

# Inside the module:
resource "aws_vpc" "this" {
  count      = var.create ? 1 : 0
  cidr_block = var.cidr_block
  tags       = { Name = var.name }
}

data "aws_vpc" "this" {
  count = var.create ? 0 : 1
  tags  = { Name = var.name }
}

output "vpc_id" {
  value = var.create ? aws_vpc.this[0].id : data.aws_vpc.this[0].id
}
```

One module, one interface, guaranteed consistency between what's created and what's looked up.

In practice, the module now has two code paths that need to stay in sync. Adding an attribute to the resource means updating both the resource block and the data source. Conditional logic with `count` makes the module harder to read. The boolean `create` flag switches the module's entire behavior, which violates the principle that a module should do one thing well.

Testing effort doubles too. You verify creation mode works, lookup mode works, and outputs are compatible in both. A refactor to one path can silently break the other, and you won't find out until someone toggles the flag in production.

The contract module solves a real problem — keeping creation and lookup in sync — but at the wrong layer. Two simple modules (one that creates, one that looks up) are easier to understand, test, and maintain than one module hiding two behaviors behind a flag.

## The naming pattern: stop sharing data entirely

The most effective approach I've found isn't a data-sharing mechanism at all. It's a naming convention.

If every team constructs resource names from the same inputs using the same rules, any configuration can derive the name of any resource without querying state files, parameter stores, or cloud APIs. You don't share the VPC ID. You compute the VPC name and look it up.

```hcl
locals {
  vpc_name = "${var.project}-${var.environment}-vpc"
}

# Producer: creates with a known name
resource "aws_vpc" "main" {
  tags = { Name = local.vpc_name }
}

# Consumer: looks up by the same known name
data "aws_vpc" "main" {
  tags = { Name = local.vpc_name }
}
```

This only works if naming is consistent. That's where most teams fail — not because they can't agree on a convention, but because enforcing it across dozens of configurations and hundreds of resources doesn't scale with manual discipline.

### Namer modules make it enforceable

The [`Azure/naming/azurerm`](https://registry.terraform.io/modules/Azure/naming/azurerm/latest) module on the Terraform Registry formalizes naming into a reusable module. It takes standard inputs and outputs correctly formatted names for every Azure resource type, respecting each resource's naming constraints (length limits, allowed characters, required prefixes).

```hcl
module "naming" {
  source  = "Azure/naming/azurerm"
  suffix  = ["production", "eastus"]
}

resource "azurerm_resource_group" "main" {
  name     = module.naming.resource_group.name
  location = "East US"
}

# Any configuration using the same suffix gets the same names
```

The [Microsoft Engineering Playbook](https://microsoft.github.io/code-with-engineering-playbook/CI-CD/recipes/terraform/share-common-variables-naming-conventions/) advocates for this pattern: sharing naming conventions and common variables across Terraform configurations rather than passing resource outputs between them. When names are deterministic, the data-sharing problem becomes a module-versioning problem, and module versioning is something Terraform already handles well.

This is a form of what HashiCorp's [module composition documentation](https://developer.hashicorp.com/terraform/language/modules/develop/composition) calls a "data-only module." Instead of a module that publishes values to an external store, you have a module that computes values from shared inputs. No state access. No external dependencies. No API calls. Pure functions from inputs to names.

### The same conclusion from a different direction

The [Terramate community](https://github.com/terramate-io/terramate/discussions/571) arrived at the same answer independently. In a discussion about passing outputs from one stack to another, the consensus was: deterministic naming eliminates most of the need for cross-stack data sharing. Encode the naming rules in a shared module and let each stack derive what it needs.

You still need a data source lookup to convert a name to a provider-generated ID. But you've eliminated the coordination problem. No configuration needs to know where another configuration stores its state, what backend it uses, or what it named its outputs.

### Where naming doesn't reach

The naming pattern works for resources with user-defined names: VPCs, subnets, security groups, IAM roles, resource groups. It doesn't work for resources with provider-generated identifiers that can't be derived from inputs, like EBS volume IDs or randomized endpoint URLs. For those, a data source lookup by tag or an SSM parameter write is still the right tool.

It also requires organizational buy-in. If one team uses `{project}-{env}-vpc` and another uses `{env}-{project}-vpc`, the pattern breaks. The namer module solves this by being the single source of truth for naming rules, but someone has to enforce that everyone uses it. Code review and module registry policies handle this in practice.

## The hierarchy

There's no single right answer, but there's a clear order of preference:

1. **Naming conventions.** Use a namer module to make resource names deterministic. This eliminates cross-configuration data sharing for the majority of cases.

2. **Provider data sources.** When you need an attribute that can't be derived from a name, look it up through the cloud API using the deterministic name as the filter.

3. **SSM or Consul.** Computed values, cross-resource metadata, or configuration that non-Terraform tools also need.

4. **`tfe_outputs`.** The cleanest option within Terraform Cloud.

5. **`terraform_remote_state`.** Prototyping only. HashiCorp warns against it. Take the warning seriously.

The pattern that scales is the one with the fewest moving parts. A namer module is just code — no state files, no external stores, no IAM policies to manage. When naming can't solve it, a provider data source is one API call away. For the edge case that needs neither (a computed value with no cloud API representation that multiple tools consume), SSM or Consul is there. But most teams will find that the first two tiers handle the majority of their cross-configuration needs.

## References

- [HashiCorp: The terraform_remote_state data source](https://developer.hashicorp.com/terraform/language/state/remote-state-data)
- [HashiCorp: Module composition](https://developer.hashicorp.com/terraform/language/modules/develop/composition)
- [HashiCorp: Consul KV documentation](https://developer.hashicorp.com/consul/docs/automate/kv)
- [Terraform Registry: tfe_outputs data source](https://registry.terraform.io/providers/hashicorp/tfe/latest/docs/data-sources/outputs)
- [Terraform Registry: Azure/naming/azurerm](https://registry.terraform.io/modules/Azure/naming/azurerm/latest)
- [Microsoft Engineering Playbook: Sharing common variables / naming conventions](https://microsoft.github.io/code-with-engineering-playbook/CI-CD/recipes/terraform/share-common-variables-naming-conventions/)
- [Terramate discussion: Pass output from one stack to another](https://github.com/terramate-io/terramate/discussions/571)
