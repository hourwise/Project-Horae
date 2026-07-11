import type { RuntimeCapability, RuntimeRegistration } from "@horae/schema";

export class RuntimeRegistry {
  private readonly registrations = new Map<string, RuntimeRegistration>();

  register(registration: RuntimeRegistration): void {
    this.registrations.set(registration.id, registration);
  }

  list(): RuntimeRegistration[] {
    return [...this.registrations.values()];
  }

  get(id: string): RuntimeRegistration | undefined {
    return this.registrations.get(id);
  }

  listHealthyCapabilities(): RuntimeCapability[] {
    return this.list()
      .filter((registration) => registration.health.status === "healthy")
      .flatMap((registration) => registration.capabilities);
  }
}
