import { SwiggyMcpClient } from "./SwiggyMcpClient.js";

async function main() {
  const client = new SwiggyMcpClient();
  console.log("Connecting to Swiggy MCP...");
  await client.connect();
  console.log("Connected to Swiggy MCP.");
  // 1) Call get_addresses and pick first address
  const addressesResult = await client.callTool("get_addresses", {});
  const addresses = (addressesResult as any)?.structuredContent?.addresses ?? (addressesResult as any)?.addresses ?? [];

  if (!Array.isArray(addresses) || addresses.length === 0) {
    console.log("search_restaurants succeeded: false");
    console.log("reason: no saved addresses available");
    return;
  }

  const first = addresses[0] as Record<string, any>;
  const addressId = String(first.id ?? first.addressId ?? first.address_id ?? "");
  if (!addressId) {
    console.log("search_restaurants succeeded: false");
    console.log("reason: first address has no id");
    return;
  }

  // 2) Call search_restaurants with the real addressId and query 'biryani'
  try {
    const searchResult = await client.callTool("search_restaurants", { addressId, query: "biryani" });

    const restaurants = (searchResult as any)?.structuredContent?.restaurants ?? (searchResult as any)?.restaurants ?? [];

    // 3) Print only the requested info
    console.log(`search_restaurants succeeded: true`);
    console.log(`restaurants returned: ${Array.isArray(restaurants) ? restaurants.length : 0}`);

    if (Array.isArray(restaurants) && restaurants.length > 0) {
      restaurants.slice(0, 200).forEach((r: any, idx: number) => {
        const name = r.name || r.restaurantName || r.title || (r.restaurant && r.restaurant.name) || "<unnamed>";
        const status = r.availabilityStatus || r.status || "<unknown>";
        const distance = r.distanceKm ?? r.distance ?? "<unknown>";
        const delivery = r.estimatedDeliveryTime || r.deliveryTime || r.deliveryInfo || "<n/a>";
        console.log(`${idx + 1}. ${name}`);
        console.log(`   availabilityStatus: ${status}`);
        console.log(`   distanceKm: ${distance}`);
        console.log(`   deliveryInfo: ${delivery}`);
      });
    }
  } catch (err: any) {
    console.log(`search_restaurants succeeded: false`);
    console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((error) => {
  console.error("Live tool test failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
