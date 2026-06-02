import * as readline from "readline";
import { FoodService } from "./services/FoodService";
import { CartService } from "./services/CartServices";
import { OrderService } from "./services/OrderServices";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const cart: any[] = [];

rl.question("Search Food: ", (foodName: string) => {
  const results = FoodService.searchFood(foodName);

  if (results.length === 0) {
    console.log("No food found");
    rl.close();
    return;
  }

  console.log("\nAvailable Foods:\n");

  results.forEach(item => {
    console.log(
      `${item.id}. ${item.restaurant} | ${item.food} | ₹${item.price} | ⭐${item.rating}`
    );
  });

  rl.question("\nEnter Item ID to add to cart: ", (idInput: string) => {
    const selected = results.find(
      item => item.id === Number(idInput)
    );

    if (!selected) {
      console.log("Invalid Item");
      rl.close();
      return;
    }

    cart.push(selected);

    console.log("\nCart:\n");

    cart.forEach(item => {
      console.log(
        `${item.restaurant} | ${item.food} | ₹${item.price}`
      );
    });

    const bill = CartService.calculateBill(cart);

    console.log("\nBill Summary");
    console.log("----------------------");
    console.log(`Subtotal     : ₹${bill.subtotal}`);
    console.log(`GST (5%)     : ₹${bill.gst.toFixed(2)}`);
    console.log(`Delivery Fee : ₹${bill.deliveryFee}`);
    console.log(`Total        : ₹${bill.total.toFixed(2)}`);

    rl.question(
      "\nPlace Order? (yes/no): ",
      (answer: string) => {
        if (answer.toLowerCase() === "yes") {
          OrderService.placeOrder();
        } else {
          OrderService.cancelOrder();
        }

        rl.close();
      }
    );
  });
});