"use strict";

const readline = require("readline");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// Local flag parser. Wires deliberately take nothing from @lens-cli/mail: they
// have no account, no identity and no mail transport.
const WIRE_BOOL_FLAGS = ["pretty", "json", "follow", "all", "help"];

function parseMailFlags(rawArgs) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (WIRE_BOOL_FLAGS.includes(key)) {
        flags[key] = true;
      } else if (rawArgs[i + 1] && !rawArgs[i + 1].startsWith("--")) {
        flags[key] = rawArgs[++i];
      } else {
        flags[key] = true;
      }
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

const MAIL_WIRE_COMMANDS = new Set([
  "mail.wire.open",
  "mail.wire.write",
  "mail.wire.read",
  "mail.wire.peers",
  "mail.wire.list",
  "mail.wire.cut",
]);

const MAIL_DAEMON_COMMANDS = new Set([
  "mail.daemon",
  "mail.daemon.start",
  "mail.daemon.stop",
  "mail.daemon.status",
  "mail.daemon.logs",
]);

class MailWireExit extends Error {
  constructor(code, message) {
    super(message || `Mail wire command exited with code ${code}`);
    this.name = "MailWireExit";
    this.code = code;
  }
}

class MailDaemonExit extends Error {
  constructor(code, message) {
    super(message || `Mail daemon command exited with code ${code}`);
    this.name = "MailDaemonExit";
    this.code = code;
  }
}

function isMailWireCommand(command) {
  return MAIL_WIRE_COMMANDS.has(command);
}

function isMailDaemonCommand(command) {
  return MAIL_DAEMON_COMMANDS.has(command);
}

function buildDependencies(overrides = {}) {
  return {
    readlineRef: overrides.readlineRef || readline,
    fsRef: overrides.fsRef || fs,
    osRef: overrides.osRef || os,
    pathRef: overrides.pathRef || path,
    spawnRef: overrides.spawnRef || spawn,
    parseMailFlags: overrides.parseMailFlags || parseMailFlags,
    loadDaemon: overrides.loadDaemon || (() => require("../daemon.cjs")),
    prompt: overrides.prompt,
    consoleRef: overrides.consoleRef || console,
    processRef: overrides.processRef || process,
    setIntervalRef: overrides.setIntervalRef || setInterval,
    clearIntervalRef: overrides.clearIntervalRef || clearInterval,
    dateNow: overrides.dateNow || Date.now,
  };
}

function defaultPrompt(question, deps) {
  const rl = deps.readlineRef.createInterface({
    input: deps.processRef.stdin,
    output: deps.processRef.stderr,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function relativeTime(isoDate, deps) {
  const now = deps.dateNow();
  const then = new Date(isoDate).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function runWireOpen(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const name = positional[0];
  let passphrase = deps.processRef.env?.LENS_WIRE_PASS || flags.pass || positional[1];

  if (!name) {
    deps.consoleRef.error("Usage: lens mail.wire.open <name> [passphrase]");
    deps.consoleRef.error("  Or: LENS_WIRE_PASS=secret lens mail.wire.open <name>");
    throw new MailWireExit(5);
  }

  if (positional[1] && !deps.processRef.env?.LENS_WIRE_PASS) {
    deps.processRef.stderr.write("\x1b[33mWarning: passphrase in command line is visible in process list.\x1b[0m\n");
    deps.processRef.stderr.write(`\x1b[33mPrefer: LENS_WIRE_PASS=secret lens mail.wire.open ${name}\x1b[0m\n`);
  }

  if (!passphrase) {
    if (!deps.processRef.stdin?.isTTY) {
      deps.consoleRef.error("Error: No passphrase. Set LENS_WIRE_PASS or provide as argument.");
      throw new MailWireExit(5);
    }
    const prompt = deps.prompt || ((question) => defaultPrompt(question, deps));
    passphrase = await prompt("Passphrase: ");
    if (!passphrase) {
      deps.consoleRef.error("Error: Passphrase is required");
      throw new MailWireExit(5);
    }
  }

  if (passphrase.length < 8) {
    deps.consoleRef.error("Error: Passphrase must be at least 8 characters");
    throw new MailWireExit(5);
  }
  if (passphrase.length < 12) {
    deps.processRef.stderr.write("\x1b[33mWarning: passphrase is short (< 12 chars). Consider a stronger one.\x1b[0m\n");
  }

  try {
    const daemon = deps.loadDaemon();
    const result = await daemon.openWire(name, passphrase);
    if (!result.ok) {
      deps.consoleRef.error(`Error: ${result.error || "Failed to open wire"}`);
      throw new MailWireExit(1);
    }
    if (flags.pretty) {
      deps.processRef.stderr.write(`Wire "${name}" ${result.existing ? "already open" : "opened"}\n`);
      deps.processRef.stderr.write(`Topic: ${result.topic.slice(0, 12)}...\n`);
    } else {
      deps.consoleRef.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    if (error instanceof MailWireExit) throw error;
    deps.consoleRef.error(`Error: ${error.message}`);
    throw new MailWireExit(3);
  }
}

async function runWireWrite(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const name = positional[0];
  const content = positional[1];

  if (!name || !content) {
    deps.consoleRef.error("Usage: lens mail.wire.write <name> \"<message>\" [--type text]");
    throw new MailWireExit(5);
  }

  try {
    const daemon = deps.loadDaemon();
    const result = await daemon.writeWire(name, content, flags.type || "text");
    if (!result.ok) {
      deps.consoleRef.error(`Error: ${result.error || "Failed to send message"}`);
      throw new MailWireExit(1);
    }
    if (flags.pretty) {
      deps.processRef.stderr.write(`Sent to "${name}" (${result.peers_sent || 0} peers)\n`);
    } else {
      deps.consoleRef.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    if (error instanceof MailWireExit) throw error;
    deps.consoleRef.error(`Error: ${error.message}`);
    throw new MailWireExit(3);
  }
}

async function runWireRead(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const name = positional[0];

  if (!name) {
    deps.consoleRef.error("Usage: lens mail.wire.read <name> [--last 10] [--live]");
    throw new MailWireExit(5);
  }

  try {
    const daemon = deps.loadDaemon();

    if (flags.live) {
      let lastSeen = 0;
      const poll = async () => {
        const result = await daemon.readWire(name);
        if (!result.ok) {
          deps.consoleRef.error(`Error: ${result.error}`);
          throw new MailWireExit(1);
        }
        const messages = result.messages || [];
        for (let i = lastSeen; i < messages.length; i += 1) {
          const msg = messages[i];
          if (flags.pretty) {
            if (msg.security_warning) deps.processRef.stderr.write(`\x1b[31m  ⚠ ${msg.security_warning}\x1b[0m\n`);
            const peer = (msg.peer_id || "unknown").slice(0, 8);
            const type = msg.type && msg.type !== "text" ? ` [${msg.type}]` : "";
            deps.processRef.stderr.write(`${peer}${type}: ${msg.content}\n`);
          } else {
            deps.consoleRef.log(JSON.stringify(msg));
          }
        }
        lastSeen = messages.length;
      };
      const safePoll = async () => {
        try {
          await poll();
        } catch (error) {
          if (error instanceof MailWireExit) {
            deps.processRef.exit(error.code);
            return;
          }
          deps.consoleRef.error(`Error: ${error.message}`);
          deps.processRef.exit(1);
        }
      };

      await safePoll();
      const interval = deps.setIntervalRef(() => {
        void safePoll();
      }, 1000);
      deps.processRef.on?.("SIGINT", () => {
        deps.clearIntervalRef(interval);
        deps.processRef.exit(0);
      });
      await new Promise(() => {});
      return;
    }

    const result = await daemon.readWire(name, flags.last ? parseInt(flags.last, 10) : undefined);
    if (!result.ok) {
      deps.consoleRef.error(`Error: ${result.error || "Failed to read wire"}`);
      throw new MailWireExit(1);
    }

    if (flags.pretty) {
      const messages = result.messages || [];
      deps.processRef.stderr.write(`Wire "${name}" — ${messages.length} messages\n\n`);
      if (messages.length === 0) {
        deps.processRef.stderr.write("  (no messages)\n");
      } else {
        for (const msg of messages) {
          if (msg.security_warning) deps.processRef.stderr.write(`\x1b[31m  ⚠ ${msg.security_warning}\x1b[0m\n`);
          const peer = (msg.peer_id || "unknown").slice(0, 8);
          const type = msg.type && msg.type !== "text" ? ` [${msg.type}]` : "";
          const time = msg.ts || msg.received_at;
          const timeStr = time ? ` (${relativeTime(time, deps)})` : "";
          deps.processRef.stderr.write(`  ${peer}${type}: ${msg.content}${timeStr}\n`);
        }
      }
    } else {
      deps.consoleRef.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    if (error instanceof MailWireExit) throw error;
    deps.consoleRef.error(`Error: ${error.message}`);
    throw new MailWireExit(3);
  }
}

async function runWirePeers(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const name = positional[0];
  if (!name) {
    deps.consoleRef.error("Usage: lens mail.wire.peers <name>");
    throw new MailWireExit(5);
  }

  try {
    const daemon = deps.loadDaemon();
    const result = await daemon.getWirePeers(name);
    if (!result.ok) {
      deps.consoleRef.error(`Error: ${result.error || "Failed to get peers"}`);
      throw new MailWireExit(1);
    }
    if (flags.pretty) {
      const peers = result.peers || [];
      deps.processRef.stderr.write(`Wire "${name}" — ${peers.length} peers\n\n`);
      if (peers.length === 0) {
        deps.processRef.stderr.write("  (no peers connected)\n");
      } else {
        const hdr = `  ${"PEER".padEnd(20)}CONNECTED`;
        deps.processRef.stderr.write(`${hdr}\n`);
        deps.processRef.stderr.write(`  ${"-".repeat(hdr.trim().length)}\n`);
        for (const peer of peers) {
          const id = (peer.peer_id || peer.peerId || "unknown").padEnd(20);
          const conn = peer.connectedAt ? relativeTime(peer.connectedAt, deps) : "";
          deps.processRef.stderr.write(`  ${id}${conn}\n`);
        }
      }
    } else {
      deps.consoleRef.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    if (error instanceof MailWireExit) throw error;
    deps.consoleRef.error(`Error: ${error.message}`);
    throw new MailWireExit(3);
  }
}

async function runWireList(args, deps) {
  const { flags } = deps.parseMailFlags(args);
  try {
    const daemon = deps.loadDaemon();
    const result = await daemon.listWires();
    if (!result.ok) {
      deps.consoleRef.error(`Error: ${result.error || "Failed to list wires"}`);
      throw new MailWireExit(1);
    }
    if (flags.pretty) {
      const wires = result.wires || [];
      deps.processRef.stderr.write(`Active wires: ${wires.length}\n\n`);
      if (wires.length === 0) {
        deps.processRef.stderr.write("  (no active wires)\n");
      } else {
        const hdr = `  ${"WIRE".padEnd(25)}${"PEERS".padEnd(10)}${"MESSAGES".padEnd(12)}OPENED`;
        deps.processRef.stderr.write(`${hdr}\n`);
        deps.processRef.stderr.write(`  ${"-".repeat(hdr.trim().length)}\n`);
        for (const wire of wires) {
          const name = (wire.name || "").slice(0, 23).padEnd(25);
          const peers = String(wire.peers || 0).padEnd(10);
          const msgs = String(wire.buffer_size || 0).padEnd(12);
          const opened = wire.createdAt ? relativeTime(wire.createdAt, deps) : "";
          deps.processRef.stderr.write(`  ${name}${peers}${msgs}${opened}\n`);
        }
      }
    } else {
      deps.consoleRef.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    if (error.message && error.message.includes("Daemon not running")) {
      if (flags.pretty) {
        deps.processRef.stderr.write("Active wires: 0\n\n  (daemon not running)\n");
      } else {
        deps.consoleRef.log(JSON.stringify({ ok: true, wires: [] }));
      }
      return;
    }
    if (error instanceof MailWireExit) throw error;
    deps.consoleRef.error(`Error: ${error.message}`);
    throw new MailWireExit(3);
  }
}

async function runWireCut(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const name = positional[0];

  if (!name && !flags.all) {
    deps.consoleRef.error("Usage: lens mail.wire.cut <name>");
    deps.consoleRef.error("       lens mail.wire.cut --all");
    throw new MailWireExit(5);
  }

  try {
    const daemon = deps.loadDaemon();
    if (flags.all) {
      const result = await daemon.closeAllWires();
      if (flags.pretty) {
        deps.processRef.stderr.write(`Closed ${result.closed || 0} wires\n`);
      } else {
        deps.consoleRef.log(JSON.stringify(result, null, 2));
      }
      return;
    }

    const result = await daemon.closeWire(name);
    if (!result.ok) {
      deps.consoleRef.error(`Error: ${result.error || "Failed to close wire"}`);
      throw new MailWireExit(1);
    }
    if (flags.pretty) {
      deps.processRef.stderr.write(`Wire "${name}" closed\n`);
    } else {
      deps.consoleRef.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    if (error instanceof MailWireExit) throw error;
    deps.consoleRef.error(`Error: ${error.message}`);
    throw new MailWireExit(3);
  }
}

async function runDaemon(args, command, deps) {
  const { flags } = deps.parseMailFlags(args);
  const subCmd = command.split(".").slice(2).join(".") || (args[0] && !args[0].startsWith("--") ? args[0] : "status");
  const daemon = deps.loadDaemon();

  try {
    if (subCmd === "start") {
      if (daemon.isDaemonRunning()) {
        deps.processRef.stderr.write("Daemon already running\n");
      } else {
        await daemon.startDaemon();
        deps.processRef.stderr.write("Daemon started\n");
      }
      return;
    }

    if (subCmd === "stop") {
      try {
        await daemon.stopDaemon();
        deps.processRef.stderr.write("Daemon stopped\n");
      } catch (error) {
        if (error.message && error.message.includes("Daemon not running")) {
          deps.processRef.stderr.write("Daemon not running\n");
        } else {
          throw error;
        }
      }
      return;
    }

    if (subCmd === "status") {
      const result = await daemon.getDaemonStatus();
      if (flags.pretty || !flags.json) {
        if (!result.running && result.running !== undefined) {
          deps.processRef.stderr.write("Daemon: not running\n");
        } else {
          deps.processRef.stderr.write("Daemon: running\n");
          if (result.pid) deps.processRef.stderr.write(`  PID: ${result.pid}\n`);
          if (result.uptime) deps.processRef.stderr.write(`  Uptime: ${result.uptime}\n`);
          deps.processRef.stderr.write(`  Wires: ${result.wires || 0}\n`);
          deps.processRef.stderr.write(`  Polling: ${result.polling ? "yes" : "no"}\n`);
          if (result.lastPoll) deps.processRef.stderr.write(`  Last poll: ${relativeTime(result.lastPoll, deps)}\n`);
        }
      } else {
        deps.consoleRef.log(JSON.stringify(result, null, 2));
      }
      return;
    }

    if (subCmd === "logs") {
      const logPath = deps.pathRef.join(deps.osRef.homedir(), ".lens", "wire-daemon.log");
      try {
        const content = deps.fsRef.readFileSync(logPath, "utf8");
        const lines = content.split("\n").filter(Boolean);
        const count = flags.lines ? parseInt(flags.lines, 10) : 50;
        const tailLines = lines.slice(-count);
        for (const line of tailLines) deps.processRef.stderr.write(`${line}\n`);
        if (flags.follow) {
          const tail = deps.spawnRef("tail", ["-f", logPath], { stdio: ["ignore", "inherit", "inherit"] });
          deps.processRef.on?.("SIGINT", () => {
            tail.kill();
            deps.processRef.exit(0);
          });
          await new Promise(() => {});
        }
      } catch {
        deps.processRef.stderr.write("No daemon logs found\n");
      }
      return;
    }

    deps.consoleRef.error(`Unknown daemon command: ${subCmd}`);
    deps.consoleRef.error("Usage: lens mail.daemon [start|stop|status|logs]");
    throw new MailDaemonExit(5);
  } catch (error) {
    if (error instanceof MailDaemonExit) throw error;
    deps.consoleRef.error(`Error: ${error.message}`);
    throw new MailDaemonExit(3);
  }
}

async function executeMailWireCommand({ command, args, ...overrides }) {
  const deps = buildDependencies(overrides);
  const runner =
    command === "mail.wire.open" ? runWireOpen :
    command === "mail.wire.write" ? runWireWrite :
    command === "mail.wire.read" ? runWireRead :
    command === "mail.wire.peers" ? runWirePeers :
    command === "mail.wire.list" ? runWireList :
    command === "mail.wire.cut" ? runWireCut : null;

  if (!runner) return false;
  await runner(args, deps);
  return true;
}

async function executeMailDaemonCommand({ command, args, ...overrides }) {
  if (!isMailDaemonCommand(command)) return false;
  const deps = buildDependencies(overrides);
  await runDaemon(args, command, deps);
  return true;
}

function runMailWireCommand({ command, args, ...overrides }) {
  return executeMailWireCommand({ command, args, ...overrides }).catch((error) => {
    const deps = buildDependencies(overrides);
    if (error instanceof MailWireExit) {
      deps.processRef.exit(error.code);
      return;
    }
    deps.consoleRef.error(`Error: ${error.message}`);
    deps.processRef.exit(1);
  });
}

function runMailDaemonCommand({ command, args, ...overrides }) {
  return executeMailDaemonCommand({ command, args, ...overrides }).catch((error) => {
    const deps = buildDependencies(overrides);
    if (error instanceof MailDaemonExit) {
      deps.processRef.exit(error.code);
      return;
    }
    deps.consoleRef.error(`Error: ${error.message}`);
    deps.processRef.exit(1);
  });
}

module.exports = {
  MAIL_DAEMON_COMMANDS,
  MAIL_WIRE_COMMANDS,
  MailDaemonExit,
  MailWireExit,
  executeMailDaemonCommand,
  executeMailWireCommand,
  isMailDaemonCommand,
  isMailWireCommand,
  runMailDaemonCommand,
  runMailWireCommand,
};
