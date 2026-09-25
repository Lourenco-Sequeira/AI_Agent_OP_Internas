/**
 * policy.service.ts
 *
 * Deterministic rules engine for expenses_policy.md. Pure function: same
 * inputs always produce the same outputs. No I/O, no LLM, no data files.
 *
 * Rules (from expenses_policy.md):
 *   - < 100 EUR              -> line manager approval.
 *   - 100 to 500 EUR         -> line manager approval + register in system.
 *   - > 500 EUR              -> line manager + Finance Manager approval + register in system.
 *   Any expense of 100 EUR or more is registered.
 *   - Category "IT equipment" (any value) -> Operations validation ALSO
 *     required, to avoid duplicate or incompatible purchases.
 */

import type {
  ExpenseCategory,
  PolicyDecision,
} from "../types/expense.js";

export interface PolicyInput {
  value: number;
  category: ExpenseCategory;
}

export function evaluateExpense(input: PolicyInput): PolicyDecision {
  const { value, category } = input;

  const decision: PolicyDecision = {
    requiredApprovers: [],
    requiredValidators: [],
    registerInSystem: false,
    reasons: [],
  };

  // --- Amount-based rules ---------------------------------------------------
  if (value < 100) {
    decision.requiredApprovers.push("line_manager");
    decision.reasons.push(
      `Valor ${formatEUR(value)} < 100 EUR: requer aprovação do manager.`,
    );
  } else if (value <= 500) {
    decision.requiredApprovers.push("line_manager");
    decision.registerInSystem = true;
    decision.reasons.push(
      `Valor ${formatEUR(value)} está entre 100 e 500 EUR: requer aprovação do manager.`,
    );
  } else {
    decision.requiredApprovers.push("line_manager", "finance_manager");
    decision.registerInSystem = true;
    decision.reasons.push(
      `Valor ${formatEUR(value)} > 500 EUR: requer aprovação do manager e da Finance Manager.`,
    );
  }

  // --- Category exception ---------------------------------------------------
  if (category === "Equipamento informático") {
    decision.requiredValidators.push("operations");
    decision.reasons.push(
      "Equipamento informático: validação adicional obrigatória por Operations (independente do valor).",
    );
  }

  return decision;
}

function formatEUR(value: number): string {
  return `${value.toLocaleString("pt-PT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} EUR`;
}
