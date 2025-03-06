#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  InitializeRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import {
  handleProviderLookup,
  handleResourceUsage,
  handleModuleRecommendations,
  handleDataSourceLookup,
  handleResourceArgumentDetails,
  handleModuleDetails
} from "./handlers/index.js";

import { 
  VERSION, 
  SERVER_NAME, 
} from "./config.js";
import logger from "./utils/logger.js";
import { 
  ProviderLookupInput,
  ResourceUsageInput,
  ModuleRecommendationsInput,
  DataSourceLookupInput,
  ModuleDetailsInput,
  ResourceDocumentationInput
} from "./types/index.js";

// Add a type definition for handleRequest which isn't directly exposed in types
declare module "@modelcontextprotocol/sdk/server/index.js" {
  interface Server {
    handleRequest(schema: any, request: any): Promise<any>;
  }
}

// Define the tools available in the server
const tools: Tool[] = [
  {
    name: "providerLookup",
    description: "Lookup a Terraform provider by name and optionally version.",
    inputSchema: { 
      type: "object", 
      properties: {
        provider: { type: "string", description: "Provider name (e.g. 'aws')" },
        namespace: { type: "string", description: "Provider namespace (e.g. 'hashicorp')" },
        version: { type: "string", description: "Provider version (e.g. '4.0.0')" }
      },
      required: ["provider"]
    }
  },
  {
    name: "resourceUsage",
    description: "Get an example usage of a Terraform resource and related resources.",
    inputSchema: { 
      type: "object", 
      properties: {
        provider: { type: "string", description: "Provider name (e.g. 'aws')" },
        resource: { type: "string", description: "Resource name (e.g. 'aws_instance')" },
        name: { type: "string", description: "Alternative resource name field (fallback if resource not specified)" }
      }
    }
  },
  {
    name: "moduleRecommendations",
    description: "Search for and recommend Terraform modules for a given query.",
    inputSchema: { 
      type: "object", 
      properties: {
        query: { type: "string", description: "Search query (e.g. 'vpc')" },
        keyword: { type: "string", description: "Alternative search keyword (fallback if query not specified)" },
        provider: { type: "string", description: "Filter modules by provider (e.g. 'aws')" }
      }
    }
  },
  {
    name: "dataSourceLookup",
    description: "List all available data sources for a provider and their basic details.",
    inputSchema: { 
      type: "object", 
      properties: {
        provider: { type: "string", description: "Provider name (e.g. 'aws')" },
        namespace: { type: "string", description: "Provider namespace (e.g. 'hashicorp')" }
      },
      required: ["provider", "namespace"]
    }
  },
  {
    name: "resourceArgumentDetails",
    description: "Fetches comprehensive details about a specific resource type's arguments, including required and optional attributes, nested blocks, and their descriptions.",
    inputSchema: { 
      type: "object", 
      properties: {
        provider: { type: "string", description: "Provider name (e.g. 'aws')" },
        namespace: { type: "string", description: "Provider namespace (e.g. 'hashicorp')" },
        resource: { type: "string", description: "Resource name (e.g. 'aws_instance')" },
        version: { type: "string", description: "Provider version (defaults to latest)" }
      },
      required: ["provider", "namespace", "resource"]
    }
  },
  {
    name: "moduleDetails",
    description: "Retrieves detailed metadata for a Terraform module including versions, inputs, outputs, and dependencies.",
    inputSchema: { 
      type: "object", 
      properties: {
        namespace: { type: "string", description: "Module namespace (e.g. 'terraform-aws-modules')" },
        module: { type: "string", description: "Module name (e.g. 'vpc')" },
        provider: { type: "string", description: "Provider name (e.g. 'aws')" }
      },
      required: ["namespace", "module", "provider"]
    }
  }
];

// Initialize the server
const server = new Server(
  {
    name: SERVER_NAME,
    version: VERSION
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Log initialization
logger.info("Server constructor created, setting up handlers...");

// Initialize handler
server.setRequestHandler(InitializeRequestSchema, async (request) => {
  logger.info("Received Initialize request!");
  logger.debug("Initialize request details:", request);
  
  return {
    protocolVersion: request.params.protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { 
      name: SERVER_NAME, 
      version: VERSION 
    }
  };
});

// ListToolsRequest handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.info("Received ListToolsRequest");
  return { tools };
});

// Validate and convert arguments
function validateArgs<T>(args: Record<string, unknown> | undefined, requiredFields: string[]): T | undefined {
  if (!args) return undefined;
  
  for (const field of requiredFields) {
    if (!(field in args)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  return args as T;
}

// Handle tool requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name: toolName, arguments: args } = request.params;

  if (!toolName) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "error",
          error: "Tool name is required"
        })
      }]
    };
  }

  try {
    let response;

    switch (toolName) {
    case "resourceArgumentDetails": {
      const validArgs = validateArgs<ResourceDocumentationInput>(args, ["namespace", "provider", "resource"]);
      if (!validArgs) throw new Error("Missing required arguments");
      response = await handleResourceArgumentDetails(validArgs);
      break;
    }
    case "resourceUsage": {
      const validArgs = validateArgs<ResourceUsageInput>(args, ["provider", "resource"]);
      if (!validArgs) throw new Error("Missing required arguments");
      response = await handleResourceUsage(validArgs);
      break;
    }
    case "providerLookup": {
      const validArgs = validateArgs<ProviderLookupInput>(args, ["provider"]);
      if (!validArgs) throw new Error("Missing required arguments");
      response = await handleProviderLookup(validArgs);
      break;
    }
    case "moduleRecommendations": {
      const validArgs = validateArgs<ModuleRecommendationsInput>(args, ["query"]);
      if (!validArgs) throw new Error("Missing required arguments");
      response = await handleModuleRecommendations(validArgs);
      break;
    }
    case "dataSourceLookup": {
      const validArgs = validateArgs<DataSourceLookupInput>(args, ["provider", "namespace"]);
      if (!validArgs) throw new Error("Missing required arguments");
      response = await handleDataSourceLookup(validArgs);
      break;
    }
    case "moduleDetails": {
      const validArgs = validateArgs<ModuleDetailsInput>(args, ["namespace", "module", "provider"]);
      if (!validArgs) throw new Error("Missing required arguments");
      response = await handleModuleDetails(validArgs);
      break;
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
    }

    return response;
  } catch (error) {
    logger.error("Error handling tool request:", error);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "error",
          error: error instanceof Error ? error.message : String(error)
        })
      }]
    };
  }
});

// Start the server
async function main() {
  console.error("🚀 Starting terraform-registry MCP server...");
  const transport = new StdioServerTransport();

  // Prevent unhandled promise rejections from crashing the server
  process.on("unhandledRejection", (reason) => {
    console.error("💥 Unhandled Promise Rejection:", reason);
  });

  try {
    await server.connect(transport);
    console.error("✅ Server connected and ready for requests");
    
    console.error("📝 Server running on stdio transport");
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("💀 Fatal error:", error);
  process.exit(1);
});