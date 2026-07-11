import type { HoraeEvent } from "@horae/schema";

export class InMemoryAuditRouter {
  private readonly events: HoraeEvent[] = [];

  emit(event: HoraeEvent): void {
    this.events.push(event);
  }

  list(): HoraeEvent[] {
    return [...this.events];
  }
}
