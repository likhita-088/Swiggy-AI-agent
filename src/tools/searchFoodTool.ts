import { FoodService } from "../services/FoodService";

export const searchFoodTool = {
  name: "search_food",
  description: "Search food items from restaurants",

  execute(foodName: string) {
    return FoodService.searchFood(foodName);
  }
};