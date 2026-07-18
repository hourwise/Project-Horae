import { randomUUID } from "node:crypto";
import type { HoraeEvent } from "@horae/schema";

export type HoraeEventInput = Omit<HoraeEvent, "id" | "occurredAt" | "payload"> & {
  id?: never;
  occurredAt?: string;
  payload?: Record<string, unknown>;
};

export class InMemoryAuditRouter {
  private readonly events: HoraeEvent[] = [];

  emit(event: HoraeEventInput): HoraeEvent {
    const record: HoraeEvent = {
      ...event,
      id: `event_${randomUUID()}`,
      occurredAt: event.occurredAt ?? new Date().toISOString(),
      ...(event.payload ? { payload: sanitize(event.payload) } : {}),
    };
    this.events.push(record);
    return record;
  }

  list(): HoraeEvent[] {
    return [...this.events];
  }
}

function sanitize(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|secret|authorization|password|task)/i.test(key)));
}
