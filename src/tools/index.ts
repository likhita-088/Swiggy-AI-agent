import { searchFoodTool } from "./searchFoodTool";
import { calculateBillTool } from "./calculateBillTool";
import { placeOrderTool } from "./placeOrderTool";
import { recommendFoodTool } from "./recommendFoodTool";

export const tools = {
  search_food: searchFoodTool,
  calculate_bill: calculateBillTool,
  place_order: placeOrderTool,
  recommend_food: recommendFoodTool
};