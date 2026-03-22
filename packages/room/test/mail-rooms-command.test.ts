import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error CommonJS module without type definitions
import * as roomCommands from "../src/commands/rooms.cjs";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("mail room command module", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects room command family members", () => {
    expect(roomCommands.isMailRoomCommand("mail.room.open")).toBe(true);
    expect(roomCommands.isMailRoomCommand("mail.room.list")).toBe(true);
    expect(roomCommands.isMailRoomCommand("mail.room.invite")).toBe(true);
    expect(roomCommands.isMailRoomCommand("mail.room.join")).toBe(true);
    expect(roomCommands.isMailRoomCommand("mail.room.write")).toBe(true);
    expect(roomCommands.isMailRoomCommand("mail.room.read")).toBe(true);
    expect(roomCommands.isMailRoomCommand("mail.room.members")).toBe(true);
    expect(roomCommands.isMailRoomCommand("mail.room.leave")).toBe(true);
    expect(roomCommands.isMailRoomCommand("mail.wire.open")).toBe(false);
  });

  it("preserves mail.room.open usage failure when room name is missing", async () => {
    const error = vi.fn();

    await expect(
      roomCommands.executeMailRoomCommand({
        command: "mail.room.open",
        args: [],
        parseMailFlags: () => ({ flags: {}, positional: [] }),
        resolveMailIdentity: () => ({ apiKey: "key" }),
        checkMailPermissions: vi.fn(),
        consoleRef: { log: vi.fn(), error },
        processRef: { exit: vi.fn(), stderr: { write: vi.fn() } },
      }),
    ).rejects.toMatchObject({ code: 5 });

    expect(error).toHaveBeenCalledWith("Usage: lens mail.room.open <name> [--desc \"description\"]");
  });

  it("preserves auth exit semantics for wrapped mail.room.list", async () => {
    const exit = vi.fn();
    const error = vi.fn();

    roomCommands.runMailRoomCommand({
      command: "mail.room.list",
      args: [],
      parseMailFlags: () => ({ flags: {}, positional: [] }),
      resolveMailIdentity: () => ({ apiKey: "key" }),
      checkMailPermissions: vi.fn(),
      mailRequest: vi.fn().mockResolvedValue({ status: 401, data: { error: "bad key" } }),
      consoleRef: { log: vi.fn(), error },
      processRef: { exit, stderr: { write: vi.fn() } },
    });

    await flushMicrotasks();
    expect(error).toHaveBeenCalledWith("Auth error: bad key");
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining("Network error:"));
    expect(exit).toHaveBeenCalledWith(2);
  });

  it("does not force a success exit for wrapped mail.room.list", async () => {
    const exit = vi.fn();
    const log = vi.fn();

    roomCommands.runMailRoomCommand({
      command: "mail.room.list",
      args: [],
      parseMailFlags: () => ({ flags: {}, positional: [] }),
      resolveMailIdentity: () => ({ apiKey: "key" }),
      checkMailPermissions: vi.fn(),
      mailRequest: vi.fn().mockResolvedValue({
        status: 200,
        data: { data: { rooms: [{ name: "ops", unread: 1, role: "owner" }] } },
      }),
      consoleRef: { log, error: vi.fn() },
      processRef: { exit, stderr: { write: vi.fn() } },
    });

    await flushMicrotasks();
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ data: { rooms: [{ name: "ops", unread: 1, role: "owner" }] } }, null, 2),
    );
    expect(exit).not.toHaveBeenCalled();
  });
});
