"use strict";

const {
  checkMailPermissions,
  parseMailFlags,
  resolveMailIdentity,
} = require("@lens-cli/mail");
const { mailRequest } = require("@lens-cli/mail");

const MAIL_ROOM_COMMANDS = new Set([
  "mail.room.open",
  "mail.room.list",
  "mail.room.invite",
  "mail.room.join",
  "mail.room.write",
  "mail.room.read",
  "mail.room.members",
  "mail.room.leave",
]);

class MailRoomExit extends Error {
  constructor(code, message) {
    super(message || `Mail room command exited with code ${code}`);
    this.name = "MailRoomExit";
    this.code = code;
  }
}

function isMailRoomCommand(command) {
  return MAIL_ROOM_COMMANDS.has(command);
}

function buildDependencies(overrides = {}) {
  return {
    parseMailFlags: overrides.parseMailFlags || parseMailFlags,
    resolveMailIdentity: overrides.resolveMailIdentity || resolveMailIdentity,
    checkMailPermissions: overrides.checkMailPermissions || checkMailPermissions,
    mailRequest: overrides.mailRequest || mailRequest,
    consoleRef: overrides.consoleRef || console,
    processRef: overrides.processRef || process,
    dateNow: overrides.dateNow || Date.now,
  };
}

function requireIdentity(flags, deps) {
  deps.checkMailPermissions();
  const identity = deps.resolveMailIdentity(flags);
  if (!identity) {
    deps.consoleRef.error("No mail identity configured.");
    deps.consoleRef.error("Run: lens mail.setup --name <name>");
    throw new MailRoomExit(2);
  }
  return identity;
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

function handleMailError(response, context, deps) {
  const { status, data } = response;
  if (status === 401 || status === 403) {
    deps.consoleRef.error(`Auth error: ${data.error || "Invalid API key"}`);
    throw new MailRoomExit(2);
  }
  if (status === 404) {
    deps.consoleRef.error(`Not found: ${data.error || context || "Resource not found"}`);
    throw new MailRoomExit(1);
  }
  if (status === 429) {
    const retryAfter = data.retryAfter || "unknown";
    deps.consoleRef.error(`Rate limited. Retry in ${retryAfter}s`);
    throw new MailRoomExit(4);
  }
  if (status === 400 || status === 422) {
    deps.consoleRef.error(`Validation error: ${data.error || "Bad request"}`);
    throw new MailRoomExit(5);
  }
  deps.consoleRef.error(`Error: HTTP ${status} — ${data.error || "Unknown error"}`);
  throw new MailRoomExit(3);
}

async function runOpen(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const identity = requireIdentity(flags, deps);
  const name = positional[0];
  if (!name) {
    deps.consoleRef.error("Usage: lens mail.room.open <name> [--desc \"description\"]");
    throw new MailRoomExit(5);
  }

  const payload = { name };
  if (flags.desc) payload.description = flags.desc;

  try {
    const response = await deps.mailRequest("POST", "/api/v1/mail/rooms", payload, identity.apiKey);
    if (response.status === 200 || response.status === 201) {
      if (flags.pretty) {
        deps.processRef.stderr.write(`Room "${name}" created\n`);
      } else {
        deps.consoleRef.log(JSON.stringify(response.data, null, 2));
      }
      return;
    }
    handleMailError(response, `room ${name}`, deps);
  } catch (err) {
    if (err instanceof MailRoomExit) throw err;
    deps.consoleRef.error(`Network error: ${err.message}`);
    throw new MailRoomExit(3);
  }
}

async function runList(args, deps) {
  const { flags } = deps.parseMailFlags(args);
  const identity = requireIdentity(flags, deps);

  try {
    const response = await deps.mailRequest("GET", "/api/v1/mail/rooms", null, identity.apiKey);
    if (response.status !== 200) return handleMailError(response, "rooms", deps);

    const result = response.data;
    if (flags.pretty) {
      const rooms = (result.data && result.data.rooms) || result.rooms || [];
      deps.processRef.stderr.write(`Rooms: ${rooms.length}\n\n`);
      if (rooms.length === 0) {
        deps.processRef.stderr.write("  (no rooms)\n");
      } else {
        const hdr = `  ${"ROOM".padEnd(25)}${"UNREAD".padEnd(10)}${"ROLE".padEnd(10)}DESCRIPTION`;
        deps.processRef.stderr.write(`${hdr}\n`);
        deps.processRef.stderr.write(`  ${"-".repeat(hdr.trim().length)}\n`);
        for (const room of rooms) {
          const name = (room.name || "").slice(0, 23).padEnd(25);
          const unread = String(room.unread || 0).padEnd(10);
          const role = String(room.role || "").padEnd(10);
          const desc = (room.description || "").slice(0, 40);
          deps.processRef.stderr.write(`  ${name}${unread}${role}${desc}\n`);
        }
      }
    } else {
      deps.consoleRef.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    if (err instanceof MailRoomExit) throw err;
    deps.consoleRef.error(`Network error: ${err.message}`);
    throw new MailRoomExit(3);
  }
}

async function runInvite(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const identity = requireIdentity(flags, deps);
  const room = positional[0];
  const address = positional[1];
  if (!room || !address) {
    deps.consoleRef.error("Usage: lens mail.room.invite <room> <address>");
    throw new MailRoomExit(5);
  }

  try {
    const response = await deps.mailRequest("POST", `/api/v1/mail/rooms/${encodeURIComponent(room)}/invite`, { address }, identity.apiKey);
    if (response.status === 200 || response.status === 201) {
      if (flags.pretty) {
        deps.processRef.stderr.write(`Invited ${address} to room "${room}"\n`);
      } else {
        deps.consoleRef.log(JSON.stringify(response.data, null, 2));
      }
      return;
    }
    handleMailError(response, `invite to ${room}`, deps);
  } catch (err) {
    if (err instanceof MailRoomExit) throw err;
    deps.consoleRef.error(`Network error: ${err.message}`);
    throw new MailRoomExit(3);
  }
}

async function runJoin(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const identity = requireIdentity(flags, deps);
  const room = positional[0];
  if (!room) {
    deps.consoleRef.error("Usage: lens mail.room.join <room>");
    throw new MailRoomExit(5);
  }

  try {
    const response = await deps.mailRequest("POST", `/api/v1/mail/rooms/${encodeURIComponent(room)}/join`, {}, identity.apiKey);
    if (response.status === 200 || response.status === 201) {
      if (flags.pretty) {
        deps.processRef.stderr.write(`Joined room "${room}"\n`);
      } else {
        deps.consoleRef.log(JSON.stringify(response.data, null, 2));
      }
      return;
    }
    handleMailError(response, `join ${room}`, deps);
  } catch (err) {
    if (err instanceof MailRoomExit) throw err;
    deps.consoleRef.error(`Network error: ${err.message}`);
    throw new MailRoomExit(3);
  }
}

async function runWrite(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const identity = requireIdentity(flags, deps);
  const room = positional[0];
  const content = positional[1];
  if (!room || !content) {
    deps.consoleRef.error("Usage: lens mail.room.write <room> \"<content>\" [--type text]");
    throw new MailRoomExit(5);
  }

  const payload = { content };
  if (flags.type) payload.type = flags.type;

  try {
    const response = await deps.mailRequest("POST", `/api/v1/mail/rooms/${encodeURIComponent(room)}/messages`, payload, identity.apiKey);
    if (response.status === 200 || response.status === 201) {
      if (flags.pretty) {
        deps.processRef.stderr.write(`Message sent to "${room}"\n`);
      } else {
        deps.consoleRef.log(JSON.stringify(response.data, null, 2));
      }
      return;
    }
    handleMailError(response, `write to ${room}`, deps);
  } catch (err) {
    if (err instanceof MailRoomExit) throw err;
    deps.consoleRef.error(`Network error: ${err.message}`);
    throw new MailRoomExit(3);
  }
}

async function runRead(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const identity = requireIdentity(flags, deps);
  const room = positional[0];
  if (!room) {
    deps.consoleRef.error("Usage: lens mail.room.read <room> [--after <seq>] [--limit 50]");
    throw new MailRoomExit(5);
  }

  const params = new URLSearchParams();
  if (flags.after) params.set("after_seq", flags.after);
  if (flags.limit) params.set("limit", flags.limit);
  const queryStr = params.toString();
  const apiPath = `/api/v1/mail/rooms/${encodeURIComponent(room)}/messages${queryStr ? `?${queryStr}` : ""}`;

  try {
    const response = await deps.mailRequest("GET", apiPath, null, identity.apiKey);
    if (response.status !== 200) return handleMailError(response, `room ${room}`, deps);

    const result = response.data;
    if (flags.pretty) {
      const messages = (result.data && result.data.messages) || result.messages || [];
      deps.processRef.stderr.write(`Room "${room}" — ${messages.length} messages\n\n`);
      if (messages.length === 0) {
        deps.processRef.stderr.write("  (no messages)\n");
      } else {
        const hdr = `  ${"SEQ".padEnd(8)}${"FROM".padEnd(25)}${"TYPE".padEnd(10)}${"TIME".padEnd(12)}CONTENT`;
        deps.processRef.stderr.write(`${hdr}\n`);
        deps.processRef.stderr.write(`  ${"-".repeat(hdr.trim().length)}\n`);
        for (const msg of messages) {
          const seq = String(msg.seq || "").padEnd(8);
          const from = (msg.sender_address || msg.from || "unknown").slice(0, 23).padEnd(25);
          const type = (msg.message_type || msg.type || "text").padEnd(10);
          const time = (msg.created_at ? relativeTime(msg.created_at, deps) : "").padEnd(12);
          const content = (msg.content || "").slice(0, 60);
          deps.processRef.stderr.write(`  ${seq}${from}${type}${time}${content}\n`);
        }
      }
    } else {
      deps.consoleRef.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    if (err instanceof MailRoomExit) throw err;
    deps.consoleRef.error(`Network error: ${err.message}`);
    throw new MailRoomExit(3);
  }
}

async function runMembers(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const identity = requireIdentity(flags, deps);
  const room = positional[0];
  if (!room) {
    deps.consoleRef.error("Usage: lens mail.room.members <room>");
    throw new MailRoomExit(5);
  }

  try {
    const response = await deps.mailRequest("GET", `/api/v1/mail/rooms/${encodeURIComponent(room)}/members`, null, identity.apiKey);
    if (response.status !== 200) return handleMailError(response, `room ${room}`, deps);

    const result = response.data;
    if (flags.pretty) {
      const members = (result.data && result.data.members) || result.members || [];
      deps.processRef.stderr.write(`Room "${room}" — ${members.length} members\n\n`);
      if (members.length === 0) {
        deps.processRef.stderr.write("  (no members)\n");
      } else {
        const hdr = `  ${"ADDRESS".padEnd(35)}${"ROLE".padEnd(12)}JOINED`;
        deps.processRef.stderr.write(`${hdr}\n`);
        deps.processRef.stderr.write(`  ${"-".repeat(hdr.trim().length)}\n`);
        for (const member of members) {
          const addr = (member.address || member.agent || "unknown").slice(0, 33).padEnd(35);
          const role = (member.role || "member").padEnd(12);
          const joined = member.joined_at ? relativeTime(member.joined_at, deps) : "";
          deps.processRef.stderr.write(`  ${addr}${role}${joined}\n`);
        }
      }
    } else {
      deps.consoleRef.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    if (err instanceof MailRoomExit) throw err;
    deps.consoleRef.error(`Network error: ${err.message}`);
    throw new MailRoomExit(3);
  }
}

async function runLeave(args, deps) {
  const { flags, positional } = deps.parseMailFlags(args);
  const identity = requireIdentity(flags, deps);
  const room = positional[0];
  if (!room) {
    deps.consoleRef.error("Usage: lens mail.room.leave <room>");
    throw new MailRoomExit(5);
  }

  try {
    const response = await deps.mailRequest("POST", `/api/v1/mail/rooms/${encodeURIComponent(room)}/leave`, {}, identity.apiKey);
    if (response.status === 200 || response.status === 204) {
      if (flags.pretty) {
        deps.processRef.stderr.write(`Left room "${room}"\n`);
      } else {
        deps.consoleRef.log(JSON.stringify(response.data || { ok: true }, null, 2));
      }
      return;
    }
    handleMailError(response, `leave ${room}`, deps);
  } catch (err) {
    if (err instanceof MailRoomExit) throw err;
    deps.consoleRef.error(`Network error: ${err.message}`);
    throw new MailRoomExit(3);
  }
}

async function executeMailRoomCommand({ command, args, ...overrides }) {
  const deps = buildDependencies(overrides);
  const runner =
    command === "mail.room.open" ? runOpen :
    command === "mail.room.list" ? runList :
    command === "mail.room.invite" ? runInvite :
    command === "mail.room.join" ? runJoin :
    command === "mail.room.write" ? runWrite :
    command === "mail.room.read" ? runRead :
    command === "mail.room.members" ? runMembers :
    command === "mail.room.leave" ? runLeave : null;

  if (!runner) return false;
  await runner(args, deps);
  return true;
}

function runMailRoomCommand({ command, args, ...overrides }) {
  return executeMailRoomCommand({ command, args, ...overrides }).catch((error) => {
    const deps = buildDependencies(overrides);
    if (error instanceof MailRoomExit) {
      deps.processRef.exit(error.code);
      return;
    }
    deps.consoleRef.error(`Error: ${error.message}`);
    deps.processRef.exit(1);
  });
}

module.exports = {
  MAIL_ROOM_COMMANDS,
  MailRoomExit,
  executeMailRoomCommand,
  isMailRoomCommand,
  runMailRoomCommand,
};
