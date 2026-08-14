import { SwiggyMcpToolService } from "./services/SwiggyMcpToolService.js";

async function run() {
  const s = new SwiggyMcpToolService();
  await s.connect();
  // Try a list of likely payment-related tool names and fetch definitions.
  const candidates = [
    'get_payment_options',
    'place_food_order',
    'place_order',
    'confirm_order',
    'get_payment_methods',
    'create_payment',
    'initiate_payment',
    'generate_upi_qr',
    'get_payment_status',
    'get_payment_options_v2'
  ];

  for (const n of candidates) {
    try {
      const def = await s.getToolDefinition(n);
      console.log(`\n=== ${n} ===`);
      console.log(def ? JSON.stringify(def, null, 2) : 'NOT FOUND');
    } catch (e) {
      console.error(`Failed to fetch ${n}:`, e && e.message ? e.message : e);
    }
  }
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
