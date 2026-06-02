import { z } from "zod";

export const OrderSchema = z.object({
  food: z.string(),

  restaurant: z
    .string()
    .nullable()
    .optional(),

  budget: z
    .number()
    .nullable()
    .optional(),

  preference: z
    .string()
    .nullable()
    .optional()
});