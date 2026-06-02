import * as readline from "readline";

interface FoodItem {
    id: number;
    restaurant: string;
    food: string;
    price: number;
    rating: number;
}

interface CartItem {
    item: FoodItem;
    quantity: number;
}

const foods: FoodItem[] = [
    {
        id: 1,
        restaurant: "Paradise",
        food: "Chicken Biryani",
        price: 299,
        rating: 4.6
    },
    {
        id: 2,
        restaurant: "Bawarchi",
        food: "Chicken Biryani",
        price: 275,
        rating: 4.4
    },
    {
        id: 3,
        restaurant: "Mehfil",
        food: "Chicken Biryani",
        price: 250,
        rating: 4.3
    },
    {
        id: 4,
        restaurant: "Dominos",
        food: "Pizza",
        price: 199,
        rating: 4.3
    },
    {
        id: 5,
        restaurant: "Pizza Hut",
        food: "Pizza",
        price: 249,
        rating: 4.5
    },
    {
        id: 6,
        restaurant: "Burger King",
        food: "Burger",
        price: 179,
        rating: 4.2
    },
    {
        id: 7,
        restaurant: "McDonald's",
        food: "Burger",
        price: 199,
        rating: 4.4
    }
];

const cart: CartItem[] = [];

function searchFood(foodName: string): FoodItem[] {
    return foods.filter(food =>
        food.food.toLowerCase().includes(foodName.toLowerCase())
    );
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question("Search Food: ", (foodName) => {

    const results = searchFood(foodName);

    if (results.length === 0) {
        console.log("\nNo food found.");
        rl.close();
        return;
    }

    console.log("\n===== AVAILABLE FOODS =====\n");

    results.forEach(item => {
        console.log(
            `${item.id}. ${item.restaurant} | ${item.food} | ₹${item.price} | ⭐${item.rating}`
        );
    });

    rl.question("\nEnter Item ID: ", (idInput) => {

        const selectedItem = foods.find(
            item => item.id === Number(idInput)
        );

        if (!selectedItem) {
            console.log("\nInvalid Item ID.");
            rl.close();
            return;
        }

        rl.question("Enter Quantity: ", (qtyInput) => {

            const quantity = Number(qtyInput);

            if (isNaN(quantity) || quantity <= 0) {
                console.log("\nInvalid Quantity.");
                rl.close();
                return;
            }

            cart.push({
                item: selectedItem,
                quantity: quantity
            });

            let subtotal = 0;

            console.log("\n===== CART =====\n");

            cart.forEach(cartItem => {

                const itemTotal =
                    cartItem.item.price * cartItem.quantity;

                subtotal += itemTotal;

                console.log(
                    `${cartItem.item.restaurant} | ${cartItem.item.food} x ${cartItem.quantity} = ₹${itemTotal}`
                );
            });

            const gst = subtotal * 0.05;
            const deliveryFee = 40;
            const finalAmount =
                subtotal + gst + deliveryFee;

            console.log("\n===== BILL =====");
            console.log(`Subtotal    : ₹${subtotal}`);
            console.log(`GST (5%)    : ₹${gst.toFixed(2)}`);
            console.log(`Delivery Fee: ₹${deliveryFee}`);
            console.log("-------------------------");
            console.log(`Total       : ₹${finalAmount.toFixed(2)}`);

            rl.question(
                "\nPlace Order? (yes/no): ",
                (answer) => {

                    if (answer.toLowerCase() === "yes") {
                        console.log("\nOrder Placed Successfully!");
                        console.log("Estimated Delivery: 25-30 mins");
                    } else {
                        console.log("\nOrder Cancelled.");
                    }

                    rl.close();
                }
            );
        });
    });
});