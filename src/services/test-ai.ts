import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  try {
    const genAI = new GoogleGenerativeAI(
      process.env.GEMINI_API_KEY as string
    );

    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash"
    });

    const result = await model.generateContent(
      "I want pizza under 250"
    );

    console.log(result.response.text());

  } catch (error) {
    console.error(error);
  }
}

main();