import { describe, expect, it } from "vitest";
import type { NodePluginToolDescriptor } from "../../packages/gateway-protocol/src/index.js";
import {
  createRegisteredNodePluginToolDescriptorMap,
  normalizeNodePluginToolDescriptors,
} from "./node-plugin-tool-snapshot.js";

function descriptor(name: string, command = "demo.echo"): NodePluginToolDescriptor {
  return {
    pluginId: "demo",
    name,
    description: `Description for ${name}`,
    command,
  };
}

describe("normalizeNodePluginToolDescriptors", () => {
  it("trusts unregistered descriptors inside the approved command surface", () => {
    const tools = normalizeNodePluginToolDescriptors({
      nodeId: "node-1",
      tools: [descriptor("demo_echo"), descriptor("demo_blocked", "demo.blocked")],
      allowedCommands: ["demo.echo"],
      registeredDescriptors: new Map(),
    });

    expect(tools.map((tool) => tool.name)).toEqual(["demo_echo"]);
  });

  it("prefers matching registered metadata and caps its description", () => {
    const registeredDescriptors = createRegisteredNodePluginToolDescriptorMap([
      {
        pluginId: "demo",
        command: {
          command: "demo.echo",
          agentTool: {
            name: "demo_echo",
            description: `  ${"r".repeat(1200)}  `,
            parameters: { type: "object", properties: { text: { type: "string" } } },
          },
        },
      },
    ]);

    const tools = normalizeNodePluginToolDescriptors({
      nodeId: "node-1",
      tools: [descriptor("demo_echo")],
      allowedCommands: ["demo.echo"],
      registeredDescriptors,
    });

    expect(tools[0]?.description).toHaveLength(1024);
    expect(tools[0]?.parameters).toEqual({
      type: "object",
      properties: { text: { type: "string" } },
    });
  });

  it("sorts before keeping at most 128 descriptors", () => {
    const tools = Array.from({ length: 130 }, (_, index) =>
      descriptor(`tool_${String(index).padStart(3, "0")}`),
    ).toReversed();

    const normalized = normalizeNodePluginToolDescriptors({
      nodeId: "node-1",
      tools,
      allowedCommands: ["demo.echo"],
      registeredDescriptors: new Map(),
    });

    expect(normalized).toHaveLength(128);
    expect(normalized[0]?.name).toBe("tool_000");
    expect(normalized[127]?.name).toBe("tool_127");
  });

  it("returns no descriptors when gateway publication is disabled", () => {
    expect(
      normalizeNodePluginToolDescriptors({
        nodeId: "node-1",
        tools: [descriptor("demo_echo")],
        allowedCommands: ["demo.echo"],
        registeredDescriptors: new Map(),
        enabled: false,
      }),
    ).toEqual([]);
  });
});
