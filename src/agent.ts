import { GeminiService } from "./services/GeminiService";
import { FoodService } from "./services/FoodService";
import { CartService } from "./services/CartServices";
import { OrderService } from "./services/OrderServices";

export class Agent {

  static async process(prompt: string) {

    console.log("\n==============================");
    console.log("[LLM] GeminiService");
    console.log("==============================");

    const order =
      await GeminiService.extractOrder(prompt);

    console.log("Food:", order.food);
    console.log("Restaurant:", order.restaurant);
    console.log("Budget:", order.budget);
    console.log("Preference:", order.preference);

    console.log("\n==============================");
    console.log("[MCP TOOL] search_food");
    console.log("==============================");

    const foods =
      FoodService.searchFood(order.food);

    console.log(
      `Found ${foods.length} matching items`
    );

    if (foods.length === 0) {

      console.log(
        "\n[MCP TOOL] recommend_food"
      );

      const recommendation =
        FoodService.getTopRecommendation(
          order.budget
        );

      if (!recommendation) {

        return `
==============================

NO FOOD AVAILABLE

==============================
`;
      }

      return `
==============================

FOOD NOT AVAILABLE

Requested Food:
${order.food}

AI RECOMMENDATION

Food:
${recommendation.food}

Restaurant:
${recommendation.restaurant}

Price:
₹${recommendation.price}

Rating:
${recommendation.rating}

Location:
${recommendation.location}

Delivery Time:
${recommendation.deliveryTime}

Would you like this instead?

==============================
`;
    }

    let selectedFood = foods[0];

    if (order.restaurant) {

      const restaurantFoods =
        foods.filter(food =>
          food.restaurant
            .toLowerCase()
            .includes(
              order.restaurant.toLowerCase()
            )
        );

      if (restaurantFoods.length > 0) {

        selectedFood =
          restaurantFoods.sort(
            (a, b) =>
              b.rating - a.rating
          )[0];
      }
    }

    if (order.budget) {

      const withinBudget =
        foods.filter(food =>
          food.price <= order.budget
        );

      if (withinBudget.length > 0) {

        selectedFood =
          withinBudget.sort(
            (a, b) =>
              b.rating - a.rating
          )[0];

      } else {

        const recommendation =
          FoodService.getTopRecommendation();

        return `
==============================

NO ${order.food.toUpperCase()}
FOUND UNDER ₹${order.budget}

AI RECOMMENDATION

Food:
${recommendation?.food}

Restaurant:
${recommendation?.restaurant}

Price:
₹${recommendation?.price}

Rating:
${recommendation?.rating}

Would you like this instead?

==============================
`;
      }
    }

    console.log(
      `Selected Food: ${selectedFood.food}`
    );

    console.log(
      `Restaurant: ${selectedFood.restaurant}`
    );

    console.log("\n==============================");
    console.log("[MCP TOOL] calculate_bill");
    console.log("==============================");

    const bill =
      CartService.calculateBill([
        selectedFood
      ]);

    console.log("Bill calculated");

    console.log("\n==============================");
    console.log("[MCP TOOL] place_order");
    console.log("==============================");

    OrderService.placeOrder();

    return `
==============================

FOOD SELECTED

Food:
${selectedFood.food}

Restaurant:
${selectedFood.restaurant}

Price:
₹${selectedFood.price}

Rating:
${selectedFood.rating}

Location:
${selectedFood.location}

Delivery Time:
${selectedFood.deliveryTime}

------------------------------

Subtotal:
₹${bill.subtotal}

GST:
₹${bill.gst}

Delivery Fee:
₹${bill.deliveryFee}

TOTAL:
₹${bill.total}

------------------------------

ORDER STATUS: SUCCESS

==============================
`;
  }
}