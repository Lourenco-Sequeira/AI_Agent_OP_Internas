/**
 * llm.service.ts
 *
 * Único lugar onde a IA é usada. A responsabilidade é estritamente: mensagem em linguagem natural -> extração estruturada em JSON.
 *
 * Tudo o resto (pesquisa de colaboradores, regras de política, criação de tarefas) é
 * TypeScript puro. Restringir o LLM a uma única tarefa específica é o que mantém o
 * agente auditável e barato.
 *
 * O modelo é o Gemini (aceita uma chave de API genérica via .env: GEMINI_API_KEY),
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { z } from "zod";
import {
  EXPENSE_CATEGORIES,
  type ExpenseExtraction,
} from "../types/expense.js";

/**
 * Contrato Zod para o payload de extração. Aplicado após a resposta do modelo para que um
 * JSON malformado ou alucinado nunca chegue ao motor de regras.
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
 * Prompt de sistema: é dito ao modelo, em termos simples, que o seu único trabalho é
 * a extração e que as decisões de política são tomadas posteriormente no código. Também
 * recebe um enum fechado para `category`, uma flag `is_expense` e exemplos
 * práticos para uma despesa (M01) e uma não-despesa (M02).
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
 * responseSchema do Gemini. Combinado com responseMimeType "application/json"
 * isto força o modelo a produzir exatamente o formato que queremos.
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
  /** Substitui a chave de API lida normalmente de GEMINI_API_KEY. */
  apiKey?: string;
  /** Substitui o modelo lido normalmente de GEMINI_MODEL. */
  model?: string;
}

/**
 * Extrai dados estruturados de despesas de uma mensagem em linguagem natural.
 *
 * Usa o Gemini quando GEMINI_API_KEY está configurada
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
    // Uma tentativa em caso de JSON inválido / incompatibilidade de esquema, depois falha de forma limpa.
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