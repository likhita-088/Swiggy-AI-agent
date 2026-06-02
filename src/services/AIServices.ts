import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY as string
);

export class AIService {
  static async getIntent(userPrompt: string) {

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash"
    });

    const prompt = `
You are a food ordering agent.

Extract:
1. Food Name
2. Max Price (if mentioned)

Return ONLY JSON.

Example:

{
  "food":"pizza",
  "maxPrice":250
}
`;

    const result = await model.generateContent(
      `${prompt}\n\nUser: ${userPrompt}`
    );

    return result.response.text();
  }
}