import { FoodService } from "../services/FoodService";

export const recommendFoodTool = {
  name: "recommend_food",

  description: "Recommend highest rated food",

  execute(budget?: number) {
    return FoodService.getTopRecommendation(budget);
  }
};