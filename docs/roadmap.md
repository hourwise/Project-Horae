# Horae Roadmap

This roadmap separates current repository evidence from planned phases.

## Current Repository Baseline

Implemented and tested:

- runtime registration and duplicate-registration rejection;
- runtime lifecycle transitions and task-ownership checks;
- heartbeat freshness assessment and stale-runtime degradation;
- exact protocol compatibility checks for selected session runtimes;
- duplicate capability-provider rejection for selected session runtimes;
- capability filtering from healthy registrations;
- session scaffolding with a distinct composition identity and derived ready/degraded assessment.

Implemented but scaffold-level:

- in-memory audit routing;
- binding interfaces for Ananke, Mnemosyne, and gateways;
- CLI command surface.

## Phase A: Strengthen the Existing Runtime Core

Near-term work justified by current code shape:

- persist correlation and audit references beyond the in-memory audit router;
- decide how negotiation failures and degraded tasks should be represented.

## Phase B: Governed Runtime Integration

Designed work already described elsewhere in the repository:

- route policy and approval requests through Ananke without giving Horae approval authority;
- integrate qualified context retrieval and reliability signals from Mnemosyne;
- encode disclosure boundaries and fallback rules in public types;
- model provider transport through a separate Model Broker boundary;
- add typed connector routes and credential-broker boundaries.

## Phase C: Recovery and Partial Outcomes

Designed work that does not yet exist in public code:

- typed aggregate task outcomes such as `PARTIAL_SUCCESS` and `RECOVERABLE_RETRY`;
- completed-effect tracking so retries do not repeat external effects;
- runtime restart and recovery semantics beyond explicit lifecycle transitions;
- task-level degraded plans and safe reduced compositions.

## Phase D: Content Surface Routing

Proposed work from the current ADR:

- mandatory Content Surface Preflight for covered content-bearing operations;
- progressive disclosure from surface observation to full content;
- receipt binding and source-mutation invalidation;
- fail-closed timeout and non-bypass enforcement.

## Open Questions Affecting Prioritisation

- whether memory is optional for every task class;
- whether authority-bearing runtimes may restart automatically;
- how safe degraded mode is defined;
- whether composition identity survives recovery;
- how multiple equivalent runtime instances should be selected.
