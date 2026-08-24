import { describe, expect, it, vi } from "vitest";
import { buildHoraeInspection } from "@horae/adrasteia-adapter";
import { RuntimeDiscoveryCoordinator, RuntimeInspectionError, RuntimeRegistry } from "@horae/runtime-core";

const timestamp = "2026-08-24T10:00:00.000Z";

function binding(version = "0.1.0") {
  return { inspect: vi.fn(async () => ({ ...buildHoraeInspection({ version, instanceId: "peer-instance", now: timestamp }), inspectionMechanism: "fixture" })) };
}

describe("RuntimeDiscoveryCoordinator", () => {
  it("turns a verified peer inspection into a supervised registration", async () => {
    const registry = new RuntimeRegistry();
    const coordinator = new RuntimeDiscoveryCoordinator(registry, () => timestamp);
    const peer = binding();

    const admitted = await coordinator.register({ id: "horae-peer", source: "pinned-inspection", binding: peer });

    expect(admitted.admission.state).toBe("admitted");
    expect(admitted.registration.identity.runtime).toBe("horae");
    expect(peer.inspect).toHaveBeenCalledWith(undefined);
  });

  it("refreshes peer data without implicitly recovering local lifecycle", async () => {
    const registry = new RuntimeRegistry();
    const first = binding("0.1.0");
    const second = binding("0.2.0");
    const coordinator = new RuntimeDiscoveryCoordinator(registry, () => timestamp);
    await coordinator.register({ id: "horae-peer", source: "pinned-inspection", binding: first });
    registry.transitionLifecycle("horae-peer", "initialising", { at: timestamp });
    registry.transitionLifecycle("horae-peer", "ready", { at: timestamp });
    registry.transitionLifecycle("horae-peer", "degraded", { at: timestamp, message: "local freshness" });

    const refreshed = await coordinator.refresh({ id: "horae-peer", source: "pinned-inspection", binding: second });

    expect(refreshed.registration.identity.version).toBe("0.2.0");
    expect(refreshed.lifecycle.state).toBe("degraded");
    expect(refreshed.observation.freshness).toBe("fresh");
  });

  it("fails closed when inspection or binding provenance is unavailable", async () => {
    const registry = new RuntimeRegistry();
    const coordinator = new RuntimeDiscoveryCoordinator(registry, () => timestamp);
    const failedBinding = { inspect: vi.fn(async () => { throw new Error("peer unavailable"); }) };

    await expect(coordinator.register({ id: "missing-peer", source: "pinned-inspection", binding: failedBinding })).rejects.toBeInstanceOf(RuntimeInspectionError);
    await expect(coordinator.register({ id: "unverified-peer", source: "unverified", binding: binding() })).rejects.toThrow("verified");
    expect(registry.list()).toHaveLength(0);
  });
});
