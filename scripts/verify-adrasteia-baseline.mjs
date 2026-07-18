import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const baseline = JSON.parse(await readFile(new URL("../docs/integration/adrasteia-baseline.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const expectedExports = [
  "RuntimeIdentitySchema",
  "RuntimeHealthSchema",
  "RuntimeReadinessSchema",
  "RuntimeRegistrationSchema",
  "CompatibilityManifestSchema",
  "AgentExecutionContextSchema",
  "ResourceScopeSchema",
  "CorrelationContextSchema",
  "negotiateDetailed",
];

function assert(condition, message) {
  if (!condition) throw new Error(`Adrasteia baseline verification failed: ${message}`);
}

assert(baseline.package.name === "project-runtime-contracts", "unexpected package name");
assert(baseline.package.version === "0.4.0", "unexpected package version");
assert(baseline.protocol.current === "1.4.0", "unexpected current protocol");
assert(baseline.protocol.minimum === "1.0.0", "unexpected minimum protocol");
assert(baseline.protocol.maximum === "1.4.0", "unexpected maximum protocol");
assert(baseline.contentPreflightIncluded === false, "content preflight must remain excluded");
assert(packageJson.dependencies[baseline.package.name] === baseline.artifact.url, "root dependency is not the immutable release URL");
assert(lock.packages["node_modules/project-runtime-contracts"]?.resolved === baseline.artifact.url, "lockfile does not resolve the immutable release URL");
assert(!JSON.stringify(lock).match(/(?:file:|\.\.\\|\.\.\/|Project-Adrasteia\\)/i), "lockfile contains a local Adrasteia path");

const contracts = await import("project-runtime-contracts");
for (const name of expectedExports) assert(name in contracts, `missing root export ${name}`);

const [artifactResponse, sidecarResponse] = await Promise.all([
  fetch(baseline.artifact.url),
  fetch(`${baseline.artifact.url}.baseline.json`),
]);
assert(artifactResponse.ok, `release artifact returned ${artifactResponse.status}`);
assert(sidecarResponse.ok, `release sidecar returned ${sidecarResponse.status}`);
const artifact = Buffer.from(await artifactResponse.arrayBuffer());
const digest = createHash("sha256").update(artifact).digest("hex");
assert(digest === baseline.artifact.sha256, "release tarball SHA-256 differs");
const sidecar = await sidecarResponse.json();
assert(sidecar.packageName === baseline.package.name && sidecar.packageVersion === baseline.package.version, "sidecar package identity differs");
assert(sidecar.protocolVersion === baseline.protocol.current, "sidecar current protocol differs");
assert(sidecar.minimumSupportedProtocolVersion === baseline.protocol.minimum, "sidecar minimum protocol differs");
assert(sidecar.supportedProtocolRange?.minimum === baseline.protocol.minimum && sidecar.supportedProtocolRange?.maximum === baseline.protocol.maximum, "sidecar protocol range differs");
assert(sidecar.contentPreflightIncluded === false, "sidecar improperly includes content preflight");

console.log(JSON.stringify({ verified: true, package: `${sidecar.packageName}@${sidecar.packageVersion}`, sha256: digest, root }));
