#!/usr/bin/env node
"use strict";

const { isRoomCommand, printRoomHelp, runRoomCommand } = require("./dispatch.cjs");

const argv = process.argv.slice(2);

if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
  printRoomHelp();
  process.exit(0);
}

if (!isRoomCommand(argv[0])) {
  console.error(`Error: Unknown command: ${argv[0]}`);
  printRoomHelp();
  process.exit(1);
}

try {
  runRoomCommand({ command: argv[0], args: argv.slice(1) });
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
