import type { RuntimeRegistration } from "@horae/schema";

export interface AnankeBinding {
  inspect(): Promise<RuntimeRegistration>;
}
