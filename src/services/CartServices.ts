import { Food } from "../models/Food";
import { Bill } from "../models/Bills";

export class CartService {
  static calculateBill(cart: Food[]): Bill {
    const subtotal = cart.reduce(
      (sum, item) => sum + item.price,
      0
    );

    const gst = subtotal * 0.05;
    const deliveryFee = 40;
    const total = subtotal + gst + deliveryFee;

    return {
      subtotal,
      gst,
      deliveryFee,
      total
    };
  }
}