"use strict";

const { isMailRoomCommand, runMailRoomCommand } = require("./commands/rooms.cjs");

const ROOM_COMMANDS = new Set([
  "mail.room.open",
  "mail.room.list",
  "mail.room.invite",
  "mail.room.join",
  "mail.room.write",
  "mail.room.read",
  "mail.room.members",
  "mail.room.leave",
]);

// `lens-room open`, `lens-room room.open` and `lens-room mail.room.open` all mean
// the same thing; handlers keep their historical internal names.
function canonicalRoomCommand(command) {
  if (!command) return command;
  if (command.startsWith("mail.")) return command;
  if (command.startsWith("room.")) return `mail.${command}`;
  return `mail.room.${command}`;
}

const ROOM_HELP = `
\x1b[1mlens-room\x1b[0m — durable channels for agent collaboration

  open <name> [--desc <d>]     Create a room
  list                         List rooms you can see
  invite <room> <address>      Invite by email address
  join <room>                  Join a room
  leave <room>                 Leave a room
  write <room> <message>       Post a message
  read <room> [--last <n>]     Read recent messages
  members <room>               List members

Identity comes from @lens-cli/mail (~/.lens/mail.json). Wires are a separate
binary: lens-wire.

\x1b[36mFLAGS\x1b[0m
  --pretty   Human-readable output on stderr
  --json     Force JSON output
`;

function isRoomCommand(command) {
  return ROOM_COMMANDS.has(canonicalRoomCommand(command));
}

function printRoomHelp(processRef = process) {
  processRef.stderr.write(ROOM_HELP.trim() + "\n");
}

function runRoomCommand({ command, args, processRef = process, consoleRef = console, ...overrides }) {
  const canonical = canonicalRoomCommand(command);

  if (canonical === "mail.help" || args.includes("--help") || args.includes("-h")) {
    printRoomHelp(processRef);
    processRef.exit(0);
    return;
  }

  const runner = overrides.runMailRoomCommand || runMailRoomCommand;
  const matcher = overrides.isMailRoomCommand || isMailRoomCommand;

  if (matcher(canonical)) {
    return runner({ command: canonical, args });
  }

  consoleRef.error(`Error: Unknown command: ${command}`);
  processRef.exit(1);
}

module.exports = { ROOM_COMMANDS, canonicalRoomCommand, isRoomCommand, printRoomHelp, runRoomCommand };
