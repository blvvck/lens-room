import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error CommonJS module without type definitions
import * as wireCommands from "../src/commands/wires.cjs";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("mail wire command module", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects wire and daemon commands", () => {
    expect(wireCommands.isMailWireCommand("mail.wire.open")).toBe(true);
    expect(wireCommands.isMailWireCommand("mail.wire.list")).toBe(true);
    expect(wireCommands.isMailDaemonCommand("mail.daemon")).toBe(true);
    expect(wireCommands.isMailDaemonCommand("mail.daemon.status")).toBe(true);
    expect(wireCommands.isMailWireCommand("mail.room.list")).toBe(false);
  });

  it("preserves mail.wire.open usage failure when wire name is missing", async () => {
    const error = vi.fn();

    await expect(
      wireCommands.executeMailWireCommand({
        command: "mail.wire.open",
        args: [],
        parseMailFlags: () => ({ flags: {}, positional: [] }),
        consoleRef: { log: vi.fn(), error },
        processRef: { exit: vi.fn(), env: {}, stderr: { write: vi.fn() }, stdin: { isTTY: false } },
      }),
    ).rejects.toMatchObject({ code: 5 });

    expect(error).toHaveBeenCalledWith("Usage: lens-wire open <name> [passphrase]");
  });

  it("does not force a success exit for wrapped mail.wire.list", async () => {
    const exit = vi.fn();
    const write = vi.fn();

    wireCommands.runMailWireCommand({
      command: "mail.wire.list",
      args: [],
      parseMailFlags: () => ({ flags: { pretty: true }, positional: [] }),
      loadDaemon: () => ({
        listWires: vi.fn().mockResolvedValue({
          ok: true,
          wires: [{ name: "ops", peers: 1, buffer_size: 2 }],
        }),
      }),
      consoleRef: { log: vi.fn(), error: vi.fn() },
      processRef: { exit, stderr: { write } },
    });

    await flushMicrotasks();
    expect(write).toHaveBeenCalledWith("Active wires: 1\n\n");
    expect(exit).not.toHaveBeenCalled();
  });

  it("preserves daemon usage failure for unknown subcommand", async () => {
    const error = vi.fn();

    await expect(
      wireCommands.executeMailDaemonCommand({
        command: "mail.daemon",
        args: ["weird"],
        parseMailFlags: () => ({ flags: {}, positional: [] }),
        loadDaemon: () => ({}),
        consoleRef: { log: vi.fn(), error },
        processRef: { exit: vi.fn(), stderr: { write: vi.fn() } },
      }),
    ).rejects.toMatchObject({ code: 5 });

    expect(error).toHaveBeenCalledWith("Unknown daemon command: weird");
  });

  it("prompts for passphrase in interactive mail.wire.open sessions", async () => {
    const openWire = vi.fn().mockResolvedValue({ ok: true, existing: false, topic: "1234567890abcdef" });
    const question = vi.fn((prompt, cb) => cb("longsecretpass"));
    const close = vi.fn();
    const write = vi.fn();

    wireCommands.runMailWireCommand({
      command: "mail.wire.open",
      args: ["ops"],
      parseMailFlags: () => ({ flags: { pretty: true }, positional: ["ops"] }),
      loadDaemon: () => ({ openWire }),
      readlineRef: {
        createInterface: () => ({ question, close }),
      },
      consoleRef: { log: vi.fn(), error: vi.fn() },
      processRef: {
        exit: vi.fn(),
        env: {},
        stdin: { isTTY: true },
        stderr: { write },
      },
    });

    await flushMicrotasks();
    expect(question).toHaveBeenCalledWith("Passphrase: ", expect.any(Function));
    expect(close).toHaveBeenCalled();
    expect(openWire).toHaveBeenCalledWith("ops", "longsecretpass");
    expect(write).toHaveBeenCalledWith('Wire "ops" opened\n');
  });

  it("does not force a success exit for wrapped mail.daemon.status", async () => {
    const exit = vi.fn();
    const write = vi.fn();

    wireCommands.runMailDaemonCommand({
      command: "mail.daemon.status",
      args: [],
      parseMailFlags: () => ({ flags: {}, positional: [] }),
      loadDaemon: () => ({
        getDaemonStatus: vi.fn().mockResolvedValue({ running: true, wires: 2, polling: true }),
      }),
      consoleRef: { log: vi.fn(), error: vi.fn() },
      processRef: { exit, stderr: { write } },
    });

    await flushMicrotasks();
    expect(write).toHaveBeenCalledWith("Daemon: running\n");
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits one when a later live wire poll fails", async () => {
    const exit = vi.fn();
    const error = vi.fn();
    let scheduledPoll: (() => void | Promise<void>) | undefined;

    wireCommands.runMailWireCommand({
      command: "mail.wire.read",
      args: ["ops", "--live"],
      parseMailFlags: () => ({ flags: { live: true }, positional: ["ops"] }),
      loadDaemon: () => ({
        readWire: vi.fn()
          .mockResolvedValueOnce({ ok: true, messages: [] })
          .mockResolvedValueOnce({ ok: false, error: "boom" }),
      }),
      setIntervalRef: (fn: () => void | Promise<void>) => {
        scheduledPoll = fn;
        return 1;
      },
      clearIntervalRef: vi.fn(),
      consoleRef: { log: vi.fn(), error },
      processRef: {
        exit,
        on: vi.fn(),
        stderr: { write: vi.fn() },
      },
    });

    await flushMicrotasks();
    await scheduledPoll?.();
    await flushMicrotasks();
    expect(error).toHaveBeenCalledWith("Error: boom");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
