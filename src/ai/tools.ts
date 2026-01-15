import type { Tool, PreCallTool, PostCallTool } from "./types";

export function isPreCallTool(tool: Tool): tool is PreCallTool {
  return tool.type === "pre-call";
}

export function isPostCallTool(tool: Tool): tool is PostCallTool {
  return tool.type === "post-call";
}

export function toFunctionSchema(tool: PostCallTool) {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const param of tool.parameters) {
    properties[param.name] = {
      type: param.type,
      description: param.description,
    };
    if (param.required) {
      required.push(param.name);
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object" as const,
      properties,
      required,
    },
  };
}
