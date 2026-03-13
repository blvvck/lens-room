"use strict";

const {
  isMailDaemonCommand,
  isMailWireCommand,
  runMailDaemonCommand,
  runMailWireCommand,
} = require("./commands/wires.cjs");

const WIRE_COMMANDS = new Set(["mail.wire.open", "mail.wire.write", "mail.wire.read",
  "mail.wire.peers", "mail.wire.list", "mail.wire.cut", "mail.daemon",
  "mail.daemon.start", "mail.daemon.stop", "mail.daemon.status", "mail.daemon.logs"]);

function canonicalWireCommand(command) {
  if (!command) return command;
  if (command.startsWith("mail.")) return command;
  if (command.startsWith("wire.")) return `mail.${command}`;
  if (command.startsWith("daemon")) return `mail.${command}`;
  return `mail.wire.${command}`;
}

const WIRE_HELP = `
\x1b[1mlens-wire\x1b[0m — ephemeral, peer-to-peer channels between agents

  open <name> <passphrase>     Join or create a wire (passphrase >= 8 chars)
  write <name> <message>       Send to connected peers
  read <name> [--last <n>]     Read the local buffer
  peers <name>                 List connected peers
  list                         List open wires
  cut <name>                   Close a wire

  daemon [start|stop|status|logs]

No account, no server-side history. The topic is derived from the name and
passphrase; peers find each other over Hyperswarm. Use LENS_WIRE_PASS to keep
the passphrase out of shell history.

\x1b[36mFILES\x1b[0m
  ~/.lens/wires.json, wire.pid, wire-daemon.sock, wire-daemon.log
`;

function isWireCommand(command) {
  return WIRE_COMMANDS.has(canonicalWireCommand(command));
}

function printWireHelp(processRef = process) {
  processRef.stderr.write(WIRE_HELP.trim() + "\n");
}

function runWireCommand({ command, args, processRef = process, consoleRef = console, ...overrides }) {
  let canonical = canonicalWireCommand(command);
  let effectiveArgs = args;

  if (canonical === "mail.daemon" && ["start", "stop", "status", "logs"].includes(args[0])) {
    canonical = `mail.daemon.${args[0]}`;
    effectiveArgs = args.slice(1);
  }

  if (effectiveArgs.includes("--help") || effectiveArgs.includes("-h")) {
    printWireHelp(processRef);
    processRef.exit(0);
    return;
  }

  const wireRunner = overrides.runMailWireCommand || runMailWireCommand;
  const wireMatcher = overrides.isMailWireCommand || isMailWireCommand;
  const daemonRunner = overrides.runMailDaemonCommand || runMailDaemonCommand;
  const daemonMatcher = overrides.isMailDaemonCommand || isMailDaemonCommand;

  if (wireMatcher(canonical)) {
    return wireRunner({ command: canonical, args: effectiveArgs });
  }
  if (daemonMatcher(canonical)) {
    return daemonRunner({ command: canonical, args: effectiveArgs });
  }

  consoleRef.error(`Error: Unknown command: ${command}`);
  processRef.exit(1);
}

module.exports = { WIRE_COMMANDS, canonicalWireCommand, isWireCommand, printWireHelp, runWireCommand };
