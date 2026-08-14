import { SwiggyMcpClient } from "./SwiggyMcpClient.js";

async function main() {
  const client = new SwiggyMcpClient();

  console.log("Connecting to Swiggy MCP...");
  await client.connect();

  const tools = await client.listTools();

  console.log(`Connected to Swiggy MCP`);
  console.log(`Discovered ${tools.length} live tools:`);
  tools.forEach((tool) => {
    console.log(`- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`);
  });
}

main().catch((error) => {
  console.error("Live tool discovery failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
