export class OrderService {
  static placeOrder(): void {
    console.log("\nOrder Placed Successfully!");
    console.log("Estimated Delivery: 25-30 mins");
  }

  static cancelOrder(): void {
    console.log("\nOrder Cancelled");
  }
}