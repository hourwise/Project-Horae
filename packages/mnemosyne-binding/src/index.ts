import { parseCompatibilityManifest, parseRuntimeHealth, parseRuntimeIdentity, parseRuntimeReadiness, parseRuntimeRegistration } from "@horae/adrasteia-adapter";
import type { PeerInspection } from "@horae/schema";

/** Mnemosyne's tagged surface is transport-neutral; Horae deliberately invents no HTTP adapter. */
export interface MnemosyneBinding {
  inspect(): Promise<PeerInspection>;
}

export class CallbackMnemosyneInspectionBinding implements MnemosyneBinding {
  constructor(private readonly inspection: () => Promise<Record<string, unknown>> | Record<string, unknown>) {}

  async inspect(): Promise<PeerInspection> {
    const value = await this.inspection();
    return {
      identity: parseRuntimeIdentity(value.identity),
      health: parseRuntimeHealth(value.health),
      readiness: parseRuntimeReadiness(value.readiness),
      registration: parseRuntimeRegistration(value.registration),
      compatibility: parseCompatibilityManifest(value.compatibility),
      inspectionMechanism: "Mnemosyne transport-neutral runtime facade or MCP inspection tool",
    };
  }
}
