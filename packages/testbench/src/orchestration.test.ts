import { describe, expect, it } from "vitest";
import { RuntimeRegistry, SessionOrchestrator } from "@horae/runtime-core";
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
  });
});
