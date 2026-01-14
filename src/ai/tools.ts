export type PreCallTool = {
  type: "pre-call";
  name: string;
  description: string;
  execute: () => Promise<Record<string, string>> | Record<string, string>;
};

export type PostCallToolParameter = {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
};

export type PostCallTool = {
  type: "post-call";
  name: string;
  description: string;
  parameters: PostCallToolParameter[];
  execute: (args: Record<string, any>) => Promise<any> | any;
};

export type Tool = PreCallTool | PostCallTool;

export type ToolCall = {
  name: string;
  arguments: Record<string, any>;
};

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
