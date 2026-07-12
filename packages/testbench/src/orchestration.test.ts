import { describe, expect, it } from "vitest";
import {
  CapabilityProviderConflictError,
  RuntimeProtocolCompatibilityError,
  RuntimeRegistry,
  SessionOrchestrator,
} from "@horae/runtime-core";
import type { HoraeProfile, RuntimeRegistration } from "@horae/runtime-core";

const profile: HoraeProfile = {
  id: "personal-development",
  displayName: "Personal Development",
  projectId: "project-horae",
  requiredRuntimeCapabilities: ["policy", "memory"],
  auditDestinations: ["local-jsonl"],
  capabilityExposure: "progressive",
};

const ananke: RuntimeRegistration = {
  id: "ananke-local",
  identity: {
    runtime: "ananke",
    version: "0.1.0",
    protocolVersion: "0.1.0",
  },
  health: {
    status: "healthy",
    checkedAt: "2026-07-10T00:00:00.000Z",
  },
  capabilities: [
    {
      id: "ananke.policy.development",
      runtimeId: "ananke-local",
      category: "policy",
      name: "Development policy",
      requiresGovernance: true,
    },
  ],
};

const mnemosyne: RuntimeRegistration = {
  id: "mnemosyne-local",
  identity: {
    runtime: "mnemosyne",
    version: "0.1.0",
    protocolVersion: "0.1.0",
  },
  health: {
    status: "healthy",
    checkedAt: "2026-07-10T00:00:00.000Z",
  },
  capabilities: [
    {
      id: "mnemosyne.memory.workspace",
      runtimeId: "mnemosyne-local",
      category: "memory",
      name: "Workspace memory",
      requiresMemory: true,
    },
  ],
};

describe("Horae orchestration scaffold", () => {
  it("builds a session from Ananke and Mnemosyne runtime registrations", () => {
    const registry = new RuntimeRegistry();
    registry.register(ananke);
    registry.register(mnemosyne);

    const orchestrator = new SessionOrchestrator(registry);
    const session = orchestrator.start(
      {
        projectId: "project-horae",
        profileId: profile.id,
        task: "Plan a governed MCP editing session",
      },
      profile,
    );

    expect(session.runtimeIds).toEqual(["ananke-local", "mnemosyne-local"]);
    expect(session.capabilityPlan.visible.map((capability) => capability.id)).toEqual([
      "ananke.policy.development",
      "mnemosyne.memory.workspace",
    ]);
    expect(session.composition).toEqual({
      id: expect.stringMatching(/^composition_\d+$/),
      runtimeIds: ["ananke-local", "mnemosyne-local"],
      capabilityIds: ["ananke.policy.development", "mnemosyne.memory.workspace"],
      createdAt: session.startedAt,
    });
    expect(session.composition.id).not.toBe(session.id);
  });

  it("assesses a session as degraded when a selected runtime is no longer healthy", () => {
    const registry = new RuntimeRegistry();
    registry.register(ananke);
    registry.register(mnemosyne);

    const orchestrator = new SessionOrchestrator(registry);
    const session = orchestrator.start(
      {
        projectId: "project-horae",
        profileId: profile.id,
        task: "Plan a governed MCP editing session",
      },
      profile,
    );

    expect(orchestrator.assessState(session, "2026-07-10T00:01:00.000Z")).toEqual({
      sessionId: session.id,
      compositionId: session.composition.id,
      state: "ready",
      checkedAt: "2026-07-10T00:01:00.000Z",
      degradedRuntimeIds: [],
    });

    registry.recordHeartbeat("ananke-local", {
      status: "degraded",
      checkedAt: "2026-07-10T00:02:00.000Z",
    });

    expect(orchestrator.assessState(session, "2026-07-10T00:03:00.000Z")).toEqual({
      sessionId: session.id,
      compositionId: session.composition.id,
      state: "degraded",
      checkedAt: "2026-07-10T00:03:00.000Z",
      degradedRuntimeIds: ["ananke-local"],
    });
  });

  it("rejects an incompatible protocol for a selected runtime before session start", () => {
    const registry = new RuntimeRegistry();
    registry.register({
      ...ananke,
      identity: {
        ...ananke.identity,
        protocolVersion: "0.0.9",
      },
    });
    registry.register(mnemosyne);

    expect(() =>
      new SessionOrchestrator(registry).start(
        {
          projectId: "project-horae",
          profileId: profile.id,
          task: "Plan a governed MCP editing session",
        },
        profile,
      ),
    ).toThrow(RuntimeProtocolCompatibilityError);
  });

  it("rejects an exact capability ID offered by multiple selected runtimes", () => {
    const registry = new RuntimeRegistry();
    registry.register(ananke);
    registry.register({
      ...ananke,
      id: "ananke-secondary",
      capabilities: ananke.capabilities.map((capability) => ({
        ...capability,
        runtimeId: "ananke-secondary",
      })),
    });
    registry.register(mnemosyne);

    expect(() =>
      new SessionOrchestrator(registry).start(
        {
          projectId: "project-horae",
          profileId: profile.id,
          task: "Plan a governed MCP editing session",
        },
        profile,
      ),
    ).toThrow(CapabilityProviderConflictError);
  });

  it("does not reject an unselected conflicting capability", () => {
    const registry = new RuntimeRegistry();
    registry.register(ananke);
    registry.register({
      ...ananke,
      id: "ananke-secondary",
      capabilities: ananke.capabilities.map((capability) => ({
        ...capability,
        runtimeId: "ananke-secondary",
      })),
    });
    registry.register(mnemosyne);

    const session = new SessionOrchestrator(registry).start(
      {
        projectId: "project-horae",
        profileId: profile.id,
        task: "Plan a memory-only session",
        requestedCapabilities: ["memory"],
      },
      profile,
    );

    expect(session.runtimeIds).toEqual(["mnemosyne-local"]);
  });
});
