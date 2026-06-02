import { FoodService } from "./services/FoodService";

const food = FoodService.getBestFood(
  "biryani",
  300,
  "Paradise"
);

console.log(food);