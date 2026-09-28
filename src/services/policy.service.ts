/**
 * policy.service.ts
 *
 * Motor de regras para expenses_policy.md. Função pura: as mesmas
 * entradas produzem sempre as mesmas saídas. Sem I/O, sem LLM, sem ficheiros de dados.
 *
 * Regras (de expenses_policy.md):
 *   - < 100 EUR -> aprovação do line manager.
 *   - 100 a 500 EUR -> aprovação do line manager + registo no sistema.
 *   - > 500 EUR -> aprovação do line manager + aprovação da Finance Manager + registo no sistema.
 *   Qualquer despesa de 100 EUR ou mais é registada.
 *   - Categoria "Equipamento informático" (qualquer valor) -> validação de Operations também
 *     é necessária, para evitar compras duplicadas ou incompatíveis.
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

  // --- Regras baseadas no valor ---------------------------------------------
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

  // --- Exceção de categoria -------------------------------------------------
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
