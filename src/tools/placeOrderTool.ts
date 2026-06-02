export const placeOrderTool = {
  name: "place_order",

  description: "Place food order",

  execute() {
    return {
      status: "success",
      message: "Order placed successfully"
    };
  }
};