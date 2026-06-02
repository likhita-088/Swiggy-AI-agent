import { CartService } from "../services/CartServices";

export const calculateBillTool = {
  name: "calculate_bill",
  description: "Calculate bill including GST and delivery charges",

  execute(cart: any[]) {
    return CartService.calculateBill(cart);
  }
};