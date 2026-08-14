import { SwiggyMcpToolService } from "./services/SwiggyMcpToolService.js";

async function run() {
  const s = new SwiggyMcpToolService();
  await s.connect();
  for (const name of ["get_food_cart", "update_food_cart", "flush_food_cart"]) {
    try {
      const def = await s.getToolDefinition(name);
      console.log(`\n=== ${name} ===`);
      console.log(JSON.stringify(def, null, 2));
    } catch (e) {
      console.error(`Failed to fetch ${name}:`, e);
    }
  }
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
