import type { RuntimeRegistration } from "@horae/schema";

export interface MnemosyneBinding {
  inspect(): Promise<RuntimeRegistration>;
}
