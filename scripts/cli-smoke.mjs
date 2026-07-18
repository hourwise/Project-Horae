import { execFileSync } from "node:child_process";
import { CompatibilityManifestSchema, RuntimeRegistrationSchema } from "project-runtime-contracts";

const cli = "packages/cli/dist/index.js";
const inspect = JSON.parse(execFileSync(process.execPath, [cli, "inspect", "--json"], { encoding: "utf8" }));
RuntimeRegistrationSchema.parse(inspect.registration);
CompatibilityManifestSchema.parse(inspect.compatibility);
const baseline = JSON.parse(execFileSync(process.execPath, [cli, "validate-baseline"], { encoding: "utf8" }));
if (!baseline.valid) throw new Error("Horae CLI baseline validation failed");
const negotiation = JSON.parse(execFileSync(process.execPath, [cli, "negotiate", "1.4.0", "1.0.0"], { encoding: "utf8" }));
if (!negotiation.compatible || negotiation.negotiatedVersion !== "1.4.0") throw new Error("Horae CLI negotiation smoke failed");
console.log(JSON.stringify({ inspected: true, baseline: true, negotiated: negotiation.negotiatedVersion }));
