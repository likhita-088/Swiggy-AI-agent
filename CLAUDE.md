# Swiggy Builders Club

When writing code against Swiggy MCP, always use the official Swiggy Builders Club documentation as the source of truth.

Documentation:
- https://mcp.swiggy.com/builders/llms.txt
- https://mcp.swiggy.com/builders/llms-full.txt
- https://mcp.swiggy.com/builders/docs/start/authenticate/
- https://mcp.swiggy.com/builders/docs/reference/food/

Rules:
- Never invent Swiggy MCP tool names.
- Never invent Swiggy MCP parameters.
- Verify tool schemas against the official documentation.
- Use the Food MCP server first.
- Do not implement Instamart or Dineout yet.
- Do not create fake Swiggy APIs or mock Swiggy responses.
- Use the real Swiggy MCP endpoint.
- Follow Swiggy's OAuth 2.1 + PKCE requirements.
- Never expose access tokens or secrets in logs or frontend code.
- Require explicit user confirmation immediately before placing an order.
- Never blindly retry place_food_order.
- Use Swiggy's documented error-handling and production guidance.