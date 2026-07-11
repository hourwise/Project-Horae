# Project Horae — Research Additions and Requirements

## Purpose

Horae is the runtime gateway and orchestration layer connecting agents, skills, tools, models, sandboxes, Ananke, and Mnemosyne.

It should remain framework-neutral rather than becoming a monolithic agent framework.

## Agent Skills compatibility

Horae should import compatible skill manifests and wrap them with governance metadata.

```ts
interface GovernedSkillRegistration {
  skillId: string;
  version: string;
  source: {
    repository?: string;
    revision?: string;
    publisher?: string;
    licence?: string;
  };
  declaredCapabilities: RuntimeCapability[];
  requiredSecrets: string[];
  networkRequirements: string[];
  supportedRuntimes: string[];
  supportedModels?: string[];
  trustState: "unreviewed" | "verified" | "restricted" | "blocked";
}
```

Horae registers and resolves skills. Ananke authorises their actions.

## Capability-based worker provisioning

```text
Task requirements
       ↓
Capability resolver
       ↓
Minimum required workers
       ↓
Runtime registration
       ↓
Minimum context package
       ↓
Execution
```

A worker exists only for a declared capability required by an active task.

## Runtime lifecycle

```ts
type RuntimeLifecycleState =
  | "registered"
  | "initialising"
  | "ready"
  | "busy"
  | "waiting"
  | "degraded"
  | "cancelling"
  | "terminated"
  | "failed";
```

Lifecycle operations:
- register
- initialise
- heartbeat
- claim task
- pause
- resume
- cancel
- terminate
- recover
- deregister

## Cancellation and abandoned work

Support:
- cancellation requests
- cooperative cancellation
- forced termination
- partial result collection
- cleanup verification
- task-state handoff
- orphan cleanup

Cancellation returns a typed outcome.

## Sandbox-neutral routing

```ts
interface ExecutionTarget {
  isolationLevel: "host" | "process" | "container" | "microvm" | "remote-sandbox";
  provider?: string;
  operatingSystem?: string;
  architecture?: string;
  networkPolicy?: string;
}
```

Horae selects the target; Ananke approves or denies execution.

## Model capability profiles

Models should be selected by declared and observed capability, not vendor name.

```ts
interface ModelCapabilityProfile {
  provider: string;
  modelId: string;
  contextWindow?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  supportsReasoningControls?: boolean;
  supportsLocalExecution?: boolean;
  supportsStreamingAudio?: boolean;
  observedReliability?: {
    successRate?: number;
    knownFailureModes?: string[];
  };
}
```

Long context is not a substitute for project memory.

## Voice capabilities

```ts
interface SpeechCapability {
  mode: "on-device" | "local-service" | "cloud";
  streaming: boolean;
  fullDuplex: boolean;
  supportedLocales: string[];
  returnsConfidence: boolean;
  interruptionSupport: boolean;
}
```

## Framework adapters

AgentScope, OpenCode-derived tools, and other runtimes may connect through adapters responsible for identity, capabilities, lifecycle, cancellation, messages, outcomes, audit correlation, memory handoff, and health.

## Laws of Horae

1. Registration precedes execution.
2. Capabilities are declared before resolution.
3. Discovery does not grant authority.
4. Every runtime has a lifecycle and health state.
5. Every task has an owner, scope, and cancellation path.
6. Runtimes receive minimum context and authority.
7. Models are selected by capability and policy, not branding.
8. Provider switches are explicit.
9. Execution location is explicit.
10. All results map to shared runtime contracts.

## Recommended next work

- Agent Skills-compatible registration
- lifecycle state machine
- cancellation and cleanup contracts
- sandbox target schema
- model capability profiles
- speech capability profiles
- external-framework adapter interface
