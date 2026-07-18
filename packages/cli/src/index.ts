#!/usr/bin/env node
import { ADRASTEIA_BASELINE, assertBaseline } from "@horae/adrasteia-adapter";
import { HoraeRuntime } from "@horae/runtime-core";

const [command = "help", ...args] = process.argv.slice(2);
const runtime = new HoraeRuntime();

if (command === "inspect") {
  const output = runtime.inspect();
  console.log(args.includes("--json") ? JSON.stringify(output) : JSON.stringify(output, null, 2));
} else if (command === "validate-baseline") {
  assertBaseline(ADRASTEIA_BASELINE);
  console.log(JSON.stringify({ valid: true, baseline: ADRASTEIA_BASELINE }));
} else if (command === "negotiate") {
  const [protocolVersion, minimumProtocolVersion] = args;
  if (!protocolVersion || !minimumProtocolVersion) {
    console.log(JSON.stringify({ implemented: false, reason: "usage: horae negotiate <protocolVersion> <minimumProtocolVersion>" }));
  } else {
    console.log(JSON.stringify(runtime.negotiateProtocol(protocolVersion, minimumProtocolVersion)));
  }
} else if (command === "help") {
  console.log("horae commands: inspect --json, validate-baseline, negotiate <protocolVersion> <minimumProtocolVersion>");
} else {
  console.log(JSON.stringify({ implemented: false, command, reason: "Horae Stage-A exposes inspection and evidence commands only." }));
}
