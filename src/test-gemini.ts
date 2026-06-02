import { GeminiService } from "./services/GeminiService";

async function main() {

  const result =
    await GeminiService.extractOrder(
      "I'm starving dude, get me something spicy from Paradise but don't blow past my 300 bucks budget"
    );

  console.log(result);

}

main();