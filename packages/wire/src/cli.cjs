#!/usr/bin/env node
"use strict";

const { isWireCommand, printWireHelp, runWireCommand } = require("./dispatch.cjs");

const argv = process.argv.slice(2);

if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
  printWireHelp();
  process.exit(0);
}

if (!isWireCommand(argv[0])) {
  console.error(`Error: Unknown command: ${argv[0]}`);
  printWireHelp();
  process.exit(1);
}

try {
  runWireCommand({ command: argv[0], args: argv.slice(1) });
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
