import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { OrderSchema } from "../schemas/OrderSchema";

dotenv.config();

const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY as string
);

export class GeminiService {

  static async extractOrder(prompt: string) {

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash"
    });

    const result = await model.generateContent(`
You are a Swiggy AI Food Ordering Assistant.

Extract food ordering information from the user's sentence.

Rules:

- spicy + Paradise = Chicken Biryani
- pizza = Pizza
- burger = Burger
- biryani = Chicken Biryani

Return ONLY valid JSON.

Example:

{
  "food": "Chicken Biryani",
  "restaurant": "Paradise",
  "budget": 300,
  "preference": "spicy"
}

User Sentence:
${prompt}
`);

    const text = result.response.text();

    const cleanText = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleanText);

    return OrderSchema.parse(parsed);
  }
}