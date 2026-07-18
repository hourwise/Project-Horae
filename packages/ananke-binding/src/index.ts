import { parseCompatibilityManifest, parseRuntimeHealth, parseRuntimeIdentity, parseRuntimeReadiness, parseRuntimeRegistration } from "@horae/adrasteia-adapter";
import type { PeerInspection } from "@horae/schema";

/** Read-only descriptive inspection only. This interface has no execute or approval method. */
export interface AnankeBinding {
  inspect(): Promise<PeerInspection>;
}

export class HttpAnankeInspectionBinding implements AnankeBinding {
  constructor(
    private readonly baseUrl: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async inspect(): Promise<PeerInspection> {
    const base = this.baseUrl.replace(/\/$/, "");
    const [identity, health, readiness, registration, compatibility] = await Promise.all([
      this.get(`${base}/api/runtime/identity`),
      this.get(`${base}/api/runtime/health`),
      this.get(`${base}/api/runtime/readiness`),
      this.get(`${base}/api/runtime/registration`),
      this.get(`${base}/api/runtime/compatibility`),
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

  private async get(url: string): Promise<unknown> {
    const response = await this.request(url, { method: "GET", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Ananke inspection unavailable: HTTP ${response.status}`);
    return response.json();
  }
}
