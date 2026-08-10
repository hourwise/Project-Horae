import {
  parseCompatibilityManifest,
  parseRuntimeHealth,
  parseRuntimeIdentity,
  parseRuntimeReadiness,
  parseRuntimeRegistration,
} from "@horae/adrasteia-adapter";
import type { PeerInspection } from "@horae/schema";

/** Read-only descriptive inspection only. This interface has no execute or approval method. */
export interface AnankeBinding {
  inspect(signal?: AbortSignal): Promise<PeerInspection>;
}

export class HttpAnankeInspectionBinding implements AnankeBinding {
  constructor(
    private readonly baseUrl: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async inspect(signal?: AbortSignal): Promise<PeerInspection> {
    const base = this.baseUrl.replace(/\/$/, "");
    const [identity, health, readiness, registration, compatibility] = await Promise.all([
      this.get(`${base}/api/runtime/identity`, signal),
      this.get(`${base}/api/runtime/health`, signal),
      this.get(`${base}/api/runtime/readiness`, signal),
      this.get(`${base}/api/runtime/registration`, signal),
      this.get(`${base}/api/runtime/compatibility`, signal),
    ]);
    return {
      identity: parseRuntimeIdentity(identity),
      health: parseRuntimeHealth(health),
      readiness: parseRuntimeReadiness(readiness),
      registration: parseRuntimeRegistration(registration),
      compatibility: parseCompatibilityManifest(compatibility),
      inspectionMechanism: "Ananke public HTTP runtime inspection endpoints",
    };
  }

  private async get(url: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.request(url, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Ananke inspection unavailable: HTTP ${response.status}`);
    return response.json();
  }
}
