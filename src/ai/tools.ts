import type {
  Tool,
  PreCallTool,
  PostCallTool,
  PostCallToolParameter,
  FunctionDefinition,
} from "./types";

/**
 * Type guard to check if a tool is a pre-call tool.
 * Pre-call tools execute before the LLM call to populate prompt variables.
 *
 * @param tool - The tool to check
 * @returns True if the tool is a PreCallTool
 *
 * @example
 * ```typescript
 * const tools: Tool[] = [...];
 * const preCallTools = tools.filter(isPreCallTool);
 * ```
 */
export function isPreCallTool(tool: Tool): tool is PreCallTool {
  return tool.type === "pre-call";
}

/**
 * Type guard to check if a tool is a post-call tool.
 * Post-call tools can be invoked by the LLM during execution (function calling).
 *
 * @param tool - The tool to check
 * @returns True if the tool is a PostCallTool
 *
 * @example
 * ```typescript
 * const tools: Tool[] = [...];
 * const postCallTools = tools.filter(isPostCallTool);
 * ```
 */
export function isPostCallTool(tool: Tool): tool is PostCallTool {
  return tool.type === "post-call";
}

/**
 * JSON Schema property definition for tool parameters.
 */
type JsonSchemaProperty = {
  type: string;
  description: string;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
};

/**
 * Convert a PostCallToolParameter to a JSON Schema property definition.
 * Handles nested object and array types.
 *
 * @param param - The parameter to convert
 * @returns JSON Schema property definition
 */
function parameterToJsonSchema(
  param: PostCallToolParameter,
): JsonSchemaProperty {
  const schema: JsonSchemaProperty = {
    type: param.type,
    description: param.description,
  };

  // Handle array types - default to string items if not specified
  if (param.type === "array") {
    schema.items = { type: "string", description: "Array item" };
  }

  // Handle object types - default to empty object if not specified
  if (param.type === "object") {
    schema.properties = {};
    schema.required = [];
  }

  return schema;
}

/**
 * Convert a PostCallTool to an OpenAI-compatible function definition schema.
 * This schema is used by LLM providers to understand what tools are available
 * and how to call them.
 *
 * @param tool - The post-call tool to convert
 * @returns OpenAI-compatible function definition
 *
 * @example
 * ```typescript
 * const tool: PostCallTool = {
 *   type: "post-call",
 *   name: "searchDatabase",
 *   description: "Search the database",
 *   parameters: [
 *     { name: "query", type: "string", description: "Search query", required: true },
 *     { name: "limit", type: "number", description: "Max results", required: false },
 *   ],
 *   execute: async (args) => { ... },
 * };
 *
 * const schema = toFunctionSchema(tool);
 * // Returns:
 * // {
 * //   name: "searchDatabase",
 * //   description: "Search the database",
 * //   parameters: {
 * //     type: "object",
 * //     properties: {
 * //       query: { type: "string", description: "Search query" },
 * //       limit: { type: "number", description: "Max results" },
 * //     },
 * //     required: ["query"],
 * //   },
 * // }
 * ```
 */
export function toFunctionSchema(tool: PostCallTool): FunctionDefinition {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const param of tool.parameters) {
    properties[param.name] = parameterToJsonSchema(param);
    if (param.required) {
      required.push(param.name);
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object",
      properties,
      required,
    },
  };
}

/**
 * Error thrown when tool validation fails.
 */
export class ToolValidationError extends Error {
  constructor(
    message: string,
    public readonly toolName?: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = "ToolValidationError";
  }
}

// Re-export types for backwards compatibility
export type { ValidateToolsOptions, ValidateToolsResult } from "./types";

import type { ValidateToolsOptions, ValidateToolsResult } from "./types";

/**
 * Validate an array of tools for common issues.
 *
 * Checks for:
 * - Duplicate tool names
 * - Empty tool names
 * - Missing required fields
 * - Invalid parameter definitions
 *
 * @param tools - Array of tools to validate
 * @param options - Validation options
 * @returns Validation result (if throwOnError is false)
 * @throws ToolValidationError if validation fails and throwOnError is true
 *
 * @example
 * ```typescript
 * // Throws on error (default)
 * validateTools(myTools);
 *
 * // Returns validation result
 * const result = validateTools(myTools, { throwOnError: false });
 * if (!result.valid) {
 *   console.error("Validation errors:", result.errors);
 * }
 * ```
 */
export function validateTools(
  tools: Tool[],
  options: ValidateToolsOptions = {},
): ValidateToolsResult {
  const { throwOnError = true } = options;
  const errors: string[] = [];
  const names = new Set<string>();

  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];
    const toolIndex = `tools[${i}]`;

    // Check for empty name
    if (!tool.name || tool.name.trim() === "") {
      errors.push(`${toolIndex}: Tool name is required`);
      continue;
    }

    // Check for duplicate names
    if (names.has(tool.name)) {
      errors.push(`${toolIndex}: Duplicate tool name "${tool.name}"`);
    } else {
      names.add(tool.name);
    }

    // Check for empty description
    if (!tool.description || tool.description.trim() === "") {
      errors.push(
        `${toolIndex} ("${tool.name}"): Tool description is required`,
      );
    }

    // Check for missing execute function
    if (!tool.execute || typeof tool.execute !== "function") {
      errors.push(
        `${toolIndex} ("${tool.name}"): Tool execute function is required`,
      );
    }

    // Additional checks for post-call tools
    if (isPostCallTool(tool)) {
      if (!Array.isArray(tool.parameters)) {
        errors.push(
          `${toolIndex} ("${tool.name}"): Post-call tool must have parameters array`,
        );
      } else {
        // Validate each parameter
        const paramNames = new Set<string>();
        for (let j = 0; j < tool.parameters.length; j++) {
          const param = tool.parameters[j];
          const paramIndex = `${toolIndex}.parameters[${j}]`;

          if (!param.name || param.name.trim() === "") {
            errors.push(`${paramIndex}: Parameter name is required`);
            continue;
          }

          if (paramNames.has(param.name)) {
            errors.push(
              `${paramIndex}: Duplicate parameter name "${param.name}"`,
            );
          } else {
            paramNames.add(param.name);
          }

          if (!param.type) {
            errors.push(
              `${paramIndex} ("${param.name}"): Parameter type is required`,
            );
          } else {
            const validTypes = [
              "string",
              "number",
              "boolean",
              "object",
              "array",
            ];
            if (!validTypes.includes(param.type)) {
              errors.push(
                `${paramIndex} ("${param.name}"): Invalid parameter type "${param.type}". ` +
                  `Must be one of: ${validTypes.join(", ")}`,
              );
            }
          }

          if (!param.description || param.description.trim() === "") {
            errors.push(
              `${paramIndex} ("${param.name}"): Parameter description is required`,
            );
          }
        }
      }
    }
  }

  const result: ValidateToolsResult = {
    valid: errors.length === 0,
    errors,
  };

  if (throwOnError && errors.length > 0) {
    throw new ToolValidationError(
      `Tool validation failed with ${errors.length} error(s):\n${errors.map((e) => `  - ${e}`).join("\n")}`,
      undefined,
      errors,
    );
  }

  return result;
}

/**
 * Get all tool names from an array of tools.
 * Useful for debugging and logging.
 *
 * @param tools - Array of tools
 * @returns Array of tool names
 */
export function getToolNames(tools: Tool[]): string[] {
  return tools.map((tool) => tool.name);
}

/**
 * Find a tool by name in an array of tools.
 *
 * @param tools - Array of tools to search
 * @param name - Name of the tool to find
 * @returns The tool if found, undefined otherwise
 */
export function findToolByName<T extends Tool>(
  tools: T[],
  name: string,
): T | undefined {
  return tools.find((tool) => tool.name === name);
}
