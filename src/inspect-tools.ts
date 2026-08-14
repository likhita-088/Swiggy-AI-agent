import { SwiggyMcpToolService } from "./services/SwiggyMcpToolService.js";

async function run() {
  const s = new SwiggyMcpToolService();
  await s.connect();
  const def = await s.getToolDefinition("get_restaurant_menu");
  console.log(JSON.stringify(def, null, 2));
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
