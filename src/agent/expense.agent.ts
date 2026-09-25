/**
 * expense.agent.ts
 *
 * Orchestrator for the "Controlo de Despesas" agent. Runs the 5-step workflow
 * described in the challenge brief:
 *
 *   1. Ingestion         -> handled by index.ts (readline)
 *   2. AI Reasoning      -> llm.service.extractExpense
 *   3. Enrichment (TS)   -> data.service.buildEmployeeContext
 *   4. Rules engine (TS) -> policy.service.evaluateExpense
 *   5. Output            -> AgentResult returned here, rendered by index.ts
 *
 * The AI is used ONLY in step 2. Steps 3-5 are deterministic TypeScript.
 */

import { extractExpense, type ExtractOptions } from "../services/llm.service.js";
import { buildEmployeeContext } from "../services/data.service.js";
import { evaluateExpense } from "../services/policy.service.js";
import type {
  Employee,
  EmployeeContext,
  ExpenseExtraction,
  PolicyDecision,
  SimulatedTask,
} from "../types/expense.js";

export interface ApproverAssignment {
  role: "line_manager" | "finance_manager";
  employee: Employee;
}

export interface ValidatorAssignment {
  role: "operations";
  employee: Employee;
}

/**
 * The successful path: extraction, employee context, policy decision, and the
 * resolved people + simulated tasks that a downstream system would create.
 */
export interface AgentSuccess {
  ok: true;
  extraction: ExpenseExtraction;
  context: EmployeeContext;
  decision: PolicyDecision;
  approvers: ApproverAssignment[];
  validators: ValidatorAssignment[];
  tasks: SimulatedTask[];
}

/**
 * Failure path: something needs human clarification. We DO NOT invent an
 * approver in this case; the caller renders the reason for the user.
 */
export interface AgentFailure {
  ok: false;
  extraction: ExpenseExtraction | null;
  reason: string;
}

export type AgentResult = AgentSuccess | AgentFailure;

export interface RunOptions extends ExtractOptions {}

/**
 * Process a single natural-language message end-to-end.
 */
export async function processExpenseMessage(
  message: string,
  options: RunOptions = {},
): Promise<AgentResult> {
  // Step 2 - AI Reasoning
  let extraction: ExpenseExtraction;
  try {
    extraction = await extractExpense(message, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      extraction: null,
      reason: `Falha ao extrair dados da mensagem: ${detail}`,
    };
  }

  if (!extraction.is_expense) {
    return {
      ok: false,
      extraction: null,
      reason:
        "A mensagem não é um pedido de despesa. Pede-se validação humana antes de avançar.",
    };
  }

  if (extraction.value <= 0) {
    return {
      ok: false,
      extraction,
      reason:
        "O pedido parece ser uma despesa, mas o valor não foi indicado. " +
        "Pede o montante em EUR antes de aplicar a política.",
    };
  }

  // Step 3 - Enrichment (traditional logic)
  const context = await buildEmployeeContext(extraction.employee_name);
  if (!context) {
    return {
      ok: false,
      extraction,
      reason:
        `Não consegui identificar de forma inequívoca o colaborador "${extraction.employee_name}" ` +
        `no diretório interno. Pede-se validação humana antes de avançar.`,
    };
  }

  if (!context.manager) {
    return {
      ok: false,
      extraction,
      reason:
        `${context.employee.name} não tem line manager registado` +
        ` (manager_id: ${context.employee.manager_id}).`,
    };
  }

  // Step 4 - Rules engine (traditional logic)
  const decision = evaluateExpense({
    value: extraction.value,
    category: extraction.category,
  });

  // Resolve role tokens -> concrete people using the enriched context.
  const approvers: ApproverAssignment[] = [];
  for (const role of decision.requiredApprovers) {
    if (role === "line_manager") {
      approvers.push({ role, employee: context.manager });
    } else if (role === "finance_manager") {
      if (!context.finance_manager) {
        return {
          ok: false,
          extraction,
          reason:
            "Regra exige aprovação da Finance Manager, mas não foi possível encontrá-la no diretório.",
        };
      }
      approvers.push({ role, employee: context.finance_manager });
    }
  }

  const validators: ValidatorAssignment[] = [];
  for (const role of decision.requiredValidators) {
    if (role === "operations") {
      if (!context.operations_contact) {
        return {
          ok: false,
          extraction,
          reason:
            "Regra exige validação de Operations, mas não foi possível encontrar um contacto activo.",
        };
      }
      validators.push({ role, employee: context.operations_contact });
    }
  }

  // Step 5 - Build simulated tasks (same shape as tasks.json entries).
  const tasks = buildSimulatedTasks(extraction, approvers, validators);

  return {
    ok: true,
    extraction,
    context,
    decision,
    approvers,
    validators,
    tasks,
  };
}

/**
 * Create the ticket list that a downstream ticketing system (see tasks.json)
 * would open. Tasks are only printed - we never write to tasks.json.
 */
function buildSimulatedTasks(
  extraction: ExpenseExtraction,
  approvers: ApproverAssignment[],
  validators: ValidatorAssignment[],
): SimulatedTask[] {
  const tasks: SimulatedTask[] = [];
  let counter = 1;
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  const nextId = () => `TSIM-${stamp}-${counter++}`;

  for (const a of approvers) {
    const title =
      a.role === "line_manager"
        ? `Rever pedido de ${extraction.item} de ${extraction.employee_name}`
        : `Aprovação Finance do pedido de ${extraction.item} de ${extraction.employee_name}`;
    tasks.push({
      id: nextId(),
      title,
      category: "expense",
      assignee_id: a.employee.id,
      status: "open",
      amount: extraction.value,
    });
  }

  for (const v of validators) {
    tasks.push({
      id: nextId(),
      title: `Validar stock/compatibilidade antes da compra (${extraction.item})`,
      category: "expense",
      assignee_id: v.employee.id,
      status: "open",
      amount: extraction.value,
    });
  }

  return tasks;
}
