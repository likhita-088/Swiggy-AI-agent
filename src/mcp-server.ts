import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { tools } from "./tools";

const server = new Server(
  {
    name: "swiggy-mcp",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(
  ListToolsRequestSchema,
  async () => {
    return {
      tools: [
        {
          name: "search_food",
          description: "Search food items from restaurants",
          inputSchema: {
            type: "object",
            properties: {
              foodName: {
                type: "string"
              }
            },
            required: ["foodName"]
          }
        },
        {
          name: "calculate_bill",
          description: "Calculate bill including GST and delivery charges",
          inputSchema: {
            type: "object",
            properties: {
              cart: {
                type: "array"
              }
            }
          }
        },
        {
          name: "place_order",
          description: "Place food order",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "recommend_food",
          description: "Recommend highest rated food",
          inputSchema: {
            type: "object",
            properties: {
              budget: {
                type: "number"
              }
            }
          }
        }
      ]
    };
  }
);

server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {

    const toolName = request.params.name;

    switch (toolName) {

      case "search_food": {

        const foodName = String(
          request.params.arguments?.foodName || ""
        );

        const result =
          tools.search_food.execute(foodName);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "calculate_bill": {

        const cart =
          (request.params.arguments?.cart as any[]) || [];

        const result =
          tools.calculate_bill.execute(cart);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "place_order": {

        const result =
          tools.place_order.execute();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "recommend_food": {

        const budget = Number(
          request.params.arguments?.budget || 0
        );

        const result =
          tools.recommend_food.execute(budget);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      default:
        throw new Error(
          `Unknown tool: ${toolName}`
        );
    }
  }
);

async function main() {

  const transport =
    new StdioServerTransport();

  await server.connect(transport);

  console.error(
    "Swiggy MCP Server Started"
  );
}

main().catch(console.error);
