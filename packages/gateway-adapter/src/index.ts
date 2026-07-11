import type { RuntimeRegistration } from "@horae/schema";

export interface GatewayAdapter {
  inspect(): Promise<RuntimeRegistration>;
}
