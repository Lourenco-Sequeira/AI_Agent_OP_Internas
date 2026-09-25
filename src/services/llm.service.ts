/**
 * llm.service.ts
 *
 * The ONLY place the AI is used. Responsibility is strictly:
 *   natural-language message -> structured JSON extraction.
 *
 * Everything else (employee lookup, policy rules, task creation) is plain
 * TypeScript. Constraining the LLM to a single narrow task is what keeps the
 * agent auditable and cheap.
 *
 * The model is Gemini (accepts a generic API key via .env: GEMINI_API_KEY),
 * with an optional local fallback when no key is configured so the prototype
 * can still be demoed without incurring API cost.
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { z } from "zod";
import {
  EXPENSE_CATEGORIES,
  type ExpenseExtraction,
} from "../types/expense.js";

/**
 * Zod contract for the extraction payload. Applied AFTER the model reply so a
 * malformed or hallucinated JSON never reaches the rules engine.
 */
const ESQUEMA_EXTRACAO = z
  .object({
    is_expense: z.boolean(),
    employee_name: z.string(),
    item: z.string(),
    value: z.number().finite().nonnegative(),
    category: z.enum(EXPENSE_CATEGORIES),
  })
  .superRefine((data, ctx) => {
    if (!data.is_expense) return;
    if (data.employee_name.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "employee_name is required when is_expense is true",
        path: ["employee_name"],
      });
    }
    if (data.item.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "item is required when is_expense is true",
        path: ["item"],
      });
    }
  });

/**
 * System prompt: the model is told, in plain terms, that its only job is
 * extraction and that policy decisions are made downstream in code. It also
 * gets a closed enum for `category`, an `is_expense` flag, and worked
 * examples for an expense (M01) and a non-expense (M02).
 */
const PROMPT = `You are the extraction component of an internal expense-control agent.

Your ONE and ONLY task is to read an internal chat message (usually in
Portuguese, sometimes in English) and return a strict JSON object with these
fields:

  - is_expense: true only when the message is a request to buy, reimburse, or
    approve a concrete expense (an item or service with a cost). Access
    requests, onboarding, document lookups, and other internal questions are
    NOT expenses: set is_expense to false.
  - employee_name: full name of the person for whom the expense is being
    requested, exactly as written in the message. Use "" when is_expense is
    false or the name is missing.
  - item: short description of the item or service. Use "" when is_expense is false.
  - value: numeric amount in euros (number, not a string; no currency symbol; use dot as decimal separator). 
    Use 0 when the amount is missing or when is_expense is false.
  - category: one of the following, and ONLY these: "Equipamento informático",
    "Outros". When is_expense is false, use "Outros".

Category guidance (only when is_expense is true):
  - Monitors, laptops, keyboards, mice, docks, headsets, cables, and any
    computer hardware/software -> "Equipamento informático".
  - If it clearly does not fit any of the above -> "Outros".

Hard rules:
  - Do NOT decide who approves the expense. Approval is applied later in code.
  - Do NOT invent employees, items, or amounts. Extract only what is in the
    message.
  - Return raw JSON only. No prose, no markdown, no comments.

Examples
--------
Message: "Preciso de um monitor novo para trabalhar em casa. A Carolina
Mendes encontrou um por 420 EUR. Como devo avancar?"
Output:
{
  "is_expense": true,
  "employee_name": "Carolina Mendes",
  "item": "monitor",
  "value": 420,
  "category": "Equipamento informático"
}

Message: "O Nuno começa segunda-feira. Acho que ainda falta tratar de alguns acessos, conseguem confirmar?"
Output:
{
  "is_expense": false,
  "employee_name": "",
  "item": "",
  "value": 0,
  "category": "Outros"
}`;

/**
 * Gemini responseSchema. Combined with responseMimeType "application/json"
 * this forces the model to output exactly the shape we want.
 */
const ESQUEMA_RESPOSTA = {
  type: SchemaType.OBJECT,
  properties: {
    is_expense: { type: SchemaType.BOOLEAN },
    employee_name: { type: SchemaType.STRING },
    item: { type: SchemaType.STRING },
    value: { type: SchemaType.NUMBER },
    category: {
      type: SchemaType.STRING,
      enum: [...EXPENSE_CATEGORIES],
    },
  },
  required: ["is_expense", "employee_name", "item", "value", "category"],
} as const;

export interface ExtractOptions {
  /** Override the API key normally read from GEMINI_API_KEY. */
  apiKey?: string;
  /** Override the model normally read from GEMINI_MODEL. */
  model?: string;
}

/**
 * Extract structured expense data from a natural-language message.
 *
 * Uses Gemini when GEMINI_API_KEY is configured; otherwise falls back to a
 * lightweight local extractor so the demo runs offline.
 */
export async function extractExpense(
  message: string,
  options: ExtractOptions = {},
): Promise<ExpenseExtraction> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";

  if (!apiKey || apiKey.trim() === "") {
    throw new Error("GEMINI_API_KEY não está configurada"); 
  }

  return callGemini(message, apiKey, model);
}

async function callGemini(
  message: string,
  apiKey: string,
  modelName: string,
): Promise<ExpenseExtraction> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: PROMPT,
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: ESQUEMA_RESPOSTA as any,
    },
  });

  const attempt = async (): Promise<ExpenseExtraction> => {
    const result = await model.generateContent(message);
    const raw = result.response.text();
    const parsed = JSON.parse(raw);
    return ESQUEMA_EXTRACAO.parse(parsed);
  };

  try {
    return await attempt();
  } catch (firstError) {
    // One retry on invalid JSON / schema mismatch, then fail cleanly.
    try {
      return await attempt();
    } catch (secondError) {
      const cause = secondError instanceof Error ? secondError.message : String(secondError);
      throw new Error(
        `LLM extraction failed after retry. Last error: ${cause}. ` +
          `Original error: ${firstError instanceof Error ? firstError.message : String(firstError)}`,
      );
    }
  }
}