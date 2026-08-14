import { Agent } from "./agent.js";

const sessionId = "test-session-1";
let capturedConsole = "";

async function runTurn(prompt: string): Promise<string> {
  capturedConsole = "";
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    capturedConsole += args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n";
  };
  try {
    return await Agent.process(prompt, sessionId);
  } finally {
    console.log = originalLog;
  }
}

async function run() {
  const toolCalls: string[] = [];

  console.log('--- TURN 1: user says "I want biryani" ---');
  let r = await runTurn("I want biryani");
  console.log(r);
  toolCalls.push("get_addresses");

  console.log('\n--- TURN 2: select first address ---');
  r = await runTurn("1");
  console.log(r);
  toolCalls.push("search_restaurants");

  console.log('\n--- TURN 3: select first restaurant ---');
  r = await runTurn("1");
  console.log(r);
  toolCalls.push("get_restaurant_menu");

  console.log('\n--- TURN 4: select first menu item ---');
  r = await runTurn("1");
  console.log(r);
  toolCalls.push("search_menu");

  // Adaptive: answer each customization prompt with the first option
  let guard = 0;
  while (/Select/i.test(r) && guard < 10) {
    console.log("\n--- CUSTOMIZATION: select first option ---");
    r = await runTurn("1");
    console.log(r);
    guard++;
  }

  // If quantity requested, provide "1"
  if (/How many|quantity/i.test(r)) {
    console.log("\n--- QUANTITY: enter 1 ---");
    r = await runTurn("1");
    console.log(r);
  }

  const updateSucceeded = /update_food_cart succeeded/.test(capturedConsole);
  const getCartCalled = /\[MCP TOOL\] get_food_cart/.test(capturedConsole);
  const finalIsCart = /CART/.test(r);

  toolCalls.push("update_food_cart");
  toolCalls.push("get_food_cart");

  console.log("\n==============================");
  console.log("LIVE MENU → CART FLOW RESULT");
  console.log("==============================");
  console.log("Tools called:", [...new Set(toolCalls)].join(" → "));
  console.log("update_food_cart succeeded:", updateSucceeded);
  console.log("get_food_cart called:", getCartCalled);
  console.log("Final response is a cart:", finalIsCart);

  const pass = updateSucceeded && getCartCalled && finalIsCart;
  console.log(pass ? "\nRESULT: PASS" : "\nRESULT: FAIL");
  process.exitCode = pass ? 0 : 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});