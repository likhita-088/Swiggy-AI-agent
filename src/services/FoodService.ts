import { foods } from "../data/foods";
import { Food } from "../models/Food";

export class FoodService {

  static searchFood(foodName: string): Food[] {
    return foods.filter(item =>
      item.food.toLowerCase().includes(foodName.toLowerCase())
    );
  }

  static getBestFood(
    foodName: string,
    budget?: number,
    restaurant?: string
  ): Food | null {

    let results = foods.filter(item =>
      item.food.toLowerCase().includes(foodName.toLowerCase())
    );

    if (restaurant) {
      results = results.filter(item =>
        item.restaurant.toLowerCase() === restaurant.toLowerCase()
      );
    }

    if (budget) {
      results = results.filter(item =>
        item.price <= budget
      );
    }

    if (results.length === 0) {
      return null;
    }

    results.sort((a, b) => b.rating - a.rating);

    return results[0];
  }

  static getTopRecommendation(budget?: number): Food | null {

    let results = [...foods];

    if (budget) {
      results = results.filter(item =>
        item.price <= budget
      );
    }

    if (results.length === 0) {
      return null;
    }

    results.sort((a, b) => b.rating - a.rating);

    return results[0];
  }
}