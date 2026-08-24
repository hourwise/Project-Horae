import { RuntimeRegistry } from "@horae/runtime-registry";
import type { PeerInspection, SupervisedRuntimeRegistration } from "@horae/schema";

/** A transport-neutral binding that returns only a parsed peer inspection. */
export interface RuntimeInspectionBinding {
  inspect(signal?: AbortSignal): Promise<PeerInspection>;
}

export interface RuntimeInspectionTarget {
  id: string;
  source: string;
  binding: RuntimeInspectionBinding;
}

export class RuntimeInspectionError extends Error {
  constructor(
    readonly runtimeId: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`Runtime inspection failed for '${runtimeId}': ${message}`);
    this.name = "RuntimeInspectionError";
  }
}

/**
 * Connects existing peer inspection bindings to Horae's admission registry.
 * No inspection result is treated as authority, execution permission, or a
 * lifecycle recovery signal.
 */
export class RuntimeDiscoveryCoordinator {
  constructor(
    private readonly registry: RuntimeRegistry,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async register(target: RuntimeInspectionTarget, signal?: AbortSignal): Promise<SupervisedRuntimeRegistration> {
    const candidate = await this.inspect(target, signal);
    return this.registry.register(candidate);
  }

  async refresh(target: RuntimeInspectionTarget, signal?: AbortSignal): Promise<SupervisedRuntimeRegistration> {
    const candidate = await this.inspect(target, signal);
    return this.registry.refresh(target.id, candidate);
  }

  private async inspect(target: RuntimeInspectionTarget, signal?: AbortSignal) {
    if (!target.id.trim()) throw new RuntimeInspectionError(target.id, "runtime id is required");
    if (!target.source.trim() || target.source === "unverified") {
      throw new RuntimeInspectionError(target.id, "inspection source must be verified");
    }
    try {
      const inspection = await target.binding.inspect(signal);
      return {
        id: target.id,
        registration: inspection.registration,
        compatibility: inspection.compatibility,
        source: target.source,
        observedAt: this.now(),
      };
    } catch (error) {
      throw new RuntimeInspectionError(target.id, error instanceof Error ? error.message : String(error), error);
    }
  }
}
