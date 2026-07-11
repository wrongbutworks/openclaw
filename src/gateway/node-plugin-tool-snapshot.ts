/** Connected node-hosted plugin tools available to agent tool resolution. */
import type { NodePluginToolDescriptor } from "../../packages/gateway-protocol/src/index.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

export type ConnectedNodePluginTool = {
  nodeId: string;
  displayName?: string;
  platform?: string;
  remoteIp?: string;
  descriptor: NodePluginToolDescriptor;
};

export type RegisteredNodePluginToolCommand = {
  pluginId: string;
  command: {
    command?: string;
    agentTool?: {
      name?: string;
      description?: string;
      parameters?: unknown;
      mcp?: {
        server?: string;
        tool?: string;
      };
    };
  };
};

const toolsByNodeId = new Map<string, ConnectedNodePluginTool[]>();
const NODE_PLUGIN_TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const NODE_PLUGIN_TOOL_DESCRIPTION_MAX_LENGTH = 1024;
const NODE_PLUGIN_TOOL_MAX_DESCRIPTORS = 128;
const log = createSubsystemLogger("gateway/node-plugin-tools");
let snapshotVersion = 0;

function bumpSnapshotVersion(): void {
  snapshotVersion += 1;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function defaultParameters(): Record<string, unknown> {
  return { type: "object", properties: {}, additionalProperties: true };
}

function isProviderSafeToolName(value: string): boolean {
  return NODE_PLUGIN_TOOL_NAME_RE.test(value);
}

export function createRegisteredNodePluginToolDescriptorMap(
  commands?: readonly RegisteredNodePluginToolCommand[],
): Map<string, NodePluginToolDescriptor> {
  const descriptors = new Map<string, NodePluginToolDescriptor>();
  for (const entry of commands ?? []) {
    const agentTool = entry.command.agentTool;
    const name = normalizeString(agentTool?.name);
    const description = normalizeString(agentTool?.description);
    const command = normalizeString(entry.command.command);
    if (!isProviderSafeToolName(name) || !description || !command) {
      continue;
    }
    const mcpServer = normalizeString(agentTool?.mcp?.server);
    const mcpTool = normalizeString(agentTool?.mcp?.tool);
    descriptors.set(`${entry.pluginId}\0${name}\0${command}`, {
      pluginId: entry.pluginId,
      name,
      description,
      parameters: normalizeRecord(agentTool?.parameters) ?? defaultParameters(),
      command,
      ...(mcpServer && mcpTool ? { mcp: { server: mcpServer, tool: mcpTool } } : {}),
    });
  }
  return descriptors;
}

export function normalizeNodePluginToolDescriptors(params: {
  nodeId: string;
  tools?: readonly NodePluginToolDescriptor[];
  allowedCommands: readonly string[];
  registeredDescriptors: ReadonlyMap<string, NodePluginToolDescriptor>;
  enabled?: boolean;
}): NodePluginToolDescriptor[] {
  if (params.enabled === false) {
    return [];
  }
  const allowedCommands = new Set(params.allowedCommands);
  const normalized: NodePluginToolDescriptor[] = [];
  // Paired nodes are the trust boundary for descriptors. Operators can disable
  // publication globally with gateway.nodes.pluginTools.enabled.
  for (const tool of params.tools ?? []) {
    const pluginId = normalizeString(tool.pluginId);
    const name = normalizeString(tool.name);
    const description = normalizeString(tool.description).slice(
      0,
      NODE_PLUGIN_TOOL_DESCRIPTION_MAX_LENGTH,
    );
    const command = normalizeString(tool.command);
    if (
      !pluginId ||
      !isProviderSafeToolName(name) ||
      !description ||
      !command ||
      !allowedCommands.has(command)
    ) {
      continue;
    }
    const registeredDescriptor = params.registeredDescriptors.get(
      `${pluginId}\0${name}\0${command}`,
    );
    const descriptor = registeredDescriptor ?? tool;
    const descriptorDescription = normalizeString(descriptor.description).slice(
      0,
      NODE_PLUGIN_TOOL_DESCRIPTION_MAX_LENGTH,
    );
    const mcpServer = normalizeString(descriptor.mcp?.server);
    const mcpTool = normalizeString(descriptor.mcp?.tool);
    normalized.push({
      pluginId,
      name,
      description: descriptorDescription,
      parameters: normalizeRecord(descriptor.parameters) ?? defaultParameters(),
      command,
      ...(mcpServer && mcpTool ? { mcp: { server: mcpServer, tool: mcpTool } } : {}),
    });
  }
  normalized.sort(
    (left, right) =>
      left.pluginId.localeCompare(right.pluginId) ||
      left.name.localeCompare(right.name) ||
      (left.command ?? "").localeCompare(right.command ?? ""),
  );
  const byKey = new Map<string, NodePluginToolDescriptor>();
  for (const descriptor of normalized) {
    const key = `${descriptor.pluginId}\0${descriptor.name}`;
    if (!byKey.has(key)) {
      byKey.set(key, descriptor);
    }
  }
  const descriptors = [...byKey.values()];
  const droppedCount = descriptors.length - NODE_PLUGIN_TOOL_MAX_DESCRIPTORS;
  if (droppedCount > 0) {
    log.warn(
      `node ${params.nodeId} published ${descriptors.length} plugin tool descriptors; dropped ${droppedCount} beyond the ${NODE_PLUGIN_TOOL_MAX_DESCRIPTORS} descriptor limit`,
    );
  }
  return descriptors.slice(0, NODE_PLUGIN_TOOL_MAX_DESCRIPTORS);
}

export function replaceConnectedNodePluginTools(params: {
  nodeId: string;
  displayName?: string;
  platform?: string;
  remoteIp?: string;
  tools: readonly NodePluginToolDescriptor[];
}): void {
  if (params.tools.length === 0) {
    const removed = toolsByNodeId.delete(params.nodeId);
    if (removed) {
      bumpSnapshotVersion();
    }
    return;
  }
  toolsByNodeId.set(
    params.nodeId,
    params.tools.map((descriptor) => ({
      nodeId: params.nodeId,
      displayName: params.displayName,
      platform: params.platform,
      remoteIp: params.remoteIp,
      descriptor,
    })),
  );
  bumpSnapshotVersion();
}

export function removeConnectedNodePluginTools(nodeId: string): void {
  const removed = toolsByNodeId.delete(nodeId);
  if (removed) {
    bumpSnapshotVersion();
  }
}

export function listConnectedNodePluginTools(): ConnectedNodePluginTool[] {
  return [...toolsByNodeId.values()]
    .flat()
    .toSorted(
      (left, right) =>
        left.descriptor.pluginId.localeCompare(right.descriptor.pluginId) ||
        left.descriptor.name.localeCompare(right.descriptor.name) ||
        left.nodeId.localeCompare(right.nodeId),
    );
}

export function getConnectedNodePluginToolsVersion(): number {
  return snapshotVersion;
}

export function resetConnectedNodePluginToolsForTest(): void {
  toolsByNodeId.clear();
  bumpSnapshotVersion();
}
