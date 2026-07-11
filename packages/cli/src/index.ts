#!/usr/bin/env node

const command = process.argv[2] ?? "help";

if (command === "help") {
  console.log("horae commands: inspect, register, plan, session, graph");
} else {
  console.log(`horae ${command}: scaffold command not implemented yet`);
}
