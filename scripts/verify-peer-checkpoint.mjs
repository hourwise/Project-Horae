import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const peer = process.argv[2];
const peers = {
  ananke: {
    repository: "https://github.com/hourwise/Project-Ananke.git",
    tag: "ananke-adrasteia-adoption-v0.1.0-protocol-1.4.0",
    commit: "dcbb115c5798072221afdd2e4fdd36e786defddf",
    checks: [{ file: "docs/HTTP_API.md", includes: ["/api/runtime/identity", "/api/runtime/health", "/api/runtime/readiness", "/api/runtime/registration", "/api/runtime/compatibility", "/api/runtime/negotiate"] }],
  },
  mnemosyne: {
    repository: "https://github.com/hourwise/Project-Mnemosyne.git",
    tag: "mnemosyne-adrasteia-adoption-v0.1.0-protocol-1.4.0",
    commit: "f4ab76a9760f856d78908d35facceb068d78c8e5",
    checks: [{ file: "docs/integration/adrasteia-stage-a.md", includes: ["transport-neutral", "runtimeIdentity", "runtimeHealth", "runtimeReadiness", "runtimeRegistration", "compatibilityManifest", "inspect", "negotiateProtocol", "without inventing an HTTP"] }],
  },
};
const config = peers[peer];
if (!config) throw new Error("usage: node scripts/verify-peer-checkpoint.mjs <ananke|mnemosyne>");

const refs = execFileSync("git", ["ls-remote", "--tags", config.repository, `${config.tag}*`], { encoding: "utf8" });
if (!refs.includes(`${config.commit}\trefs/tags/${config.tag}^{}`)) throw new Error(`${peer} tag does not resolve to the pinned commit`);

const scratch = await mkdtemp(join(tmpdir(), `horae-${peer}-checkpoint-`));
try {
  const checkout = join(scratch, peer);
  execFileSync("git", ["clone", "--depth", "1", "--branch", config.tag, config.repository, checkout], { stdio: "ignore" });
  const actualCommit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (actualCommit !== config.commit) throw new Error(`${peer} checkout commit differs from the pin`);
  for (const check of config.checks) {
    const text = await readFile(join(checkout, check.file), "utf8");
    for (const required of check.includes) {
      if (!text.includes(required)) throw new Error(`${peer} checkpoint lacks required inspection surface: ${required}`);
    }
  }
  console.log(JSON.stringify({ verified: true, peer, tag: config.tag, commit: actualCommit, inspectionOnly: true }));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
