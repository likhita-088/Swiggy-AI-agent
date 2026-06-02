import * as readline from "readline";
import { FoodService } from "./services/FoodService";
import { CartService } from "./services/CartServices";
import { OrderService } from "./services/OrderServices";
import { SessionMemory } from "./session/SessionMemory";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function startAgent() {
  rl.question(
    "\nWhat would you like to eat? ",
    (foodName: string) => {

      if (foodName.toLowerCase() === "exit") {
        console.log("\nThank you for using Swiggy AI Agent!");
        rl.close();
        return;
      }

      // Session Memory
      const previousFood =
        SessionMemory.get("lastFood");

      if (
        previousFood &&
        foodName.toLowerCase() === "same"
      ) {
        foodName = previousFood;
      }

      const results =
        FoodService.searchFood(foodName);

      if (results.length === 0) {

        console.log(
          "\nFood not found. Showing recommendation..."
        );

        const recommendation =
          FoodService.getTopRecommendation();

        if (recommendation) {

          console.log("\nRecommended:");

          console.log(
            `${recommendation.restaurant} | ${recommendation.food} | ₹${recommendation.price}`
          );
        }

        startAgent();
        return;
      }

      console.log("\nAvailable Foods:\n");

      results.forEach(item => {
        console.log(
          `${item.id}. ${item.restaurant} | ${item.food} | ₹${item.price} | ⭐${item.rating}`
        );
      });

      rl.question(
        "\nEnter Item ID to add to cart: ",
        (idInput: string) => {

          const selected =
            results.find(
              item =>
                item.id === Number(idInput)
            );

          if (!selected) {
            console.log("Invalid Item");
            startAgent();
            return;
          }

          // Save in session memory
          SessionMemory.set(
            "lastFood",
            selected.food
          );

          const cart = [selected];

          const bill =
            CartService.calculateBill(cart);

          console.log("\nBill Summary");
          console.log("----------------------");
          console.log(
            `Subtotal     : ₹${bill.subtotal}`
          );
          console.log(
            `GST (5%)     : ₹${bill.gst.toFixed(2)}`
          );
          console.log(
            `Delivery Fee : ₹${bill.deliveryFee}`
          );
          console.log(
            `Total        : ₹${bill.total.toFixed(2)}`
          );

          rl.question(
            "\nPlace Order? (yes/no): ",
            (answer: string) => {

              if (
                answer.toLowerCase() ===
                "yes"
              ) {

                OrderService.placeOrder();

                console.log(
                  "\nOrder placed successfully!"
                );

              } else {

                OrderService.cancelOrder();

                console.log(
                  "\nOrder cancelled."
                );
              }

              startAgent();
            }
          );
        }
      );
    }
  );
}

console.log("\n==============================");
console.log("SWIGGY AI AGENT");
console.log("==============================");

console.log(
  "\nType 'same' to reorder last food"
);

console.log(
  "Type 'exit' to close the application"
);

startAgent();