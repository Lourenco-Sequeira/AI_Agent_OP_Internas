/**
 * expense.agent.ts
 *
 * Orquestrador para o agente "Controlo de Despesas". Executa o fluxo de trabalho de 5 passos
 * descrito no briefing do desafio:
 *
 *   1. Ingestão -> gerido por index.ts (readline)
 *   2. Raciocínio de IA -> llm.service.extractExpense
 *   3. Enriquecimento (TS) -> data.service.buildEmployeeContext
 *   4. Motor de regras (TS) -> policy.service.evaluateExpense
 *   5. Saída -> AgentResult retornado aqui, renderizado por index.ts
 *
 * A IA é utilizada APENAS no passo 2. Os passos 3-5 são TypeScript determinístico.
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
 * Em caso de sucesso: extração, contexto do colaborador, decisão da política e as
 * pessoas resolvidas + tarefas simuladas que um sistema posterior criaria.
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
 * Em caso de falha: algo precisa de clarificação humana. Não se inventa um
 * aprovador neste caso; o chamador renderiza o motivo para o utilizador.
 */
export interface AgentFailure {
  ok: false;
  extraction: ExpenseExtraction | null;
  reason: string;
}

export type AgentResult = AgentSuccess | AgentFailure;

export interface RunOptions extends ExtractOptions {}

/**
 * Processa uma única mensagem em linguagem natural.
 */
export async function processExpenseMessage(
  message: string,
  options: RunOptions = {},
): Promise<AgentResult> {
  // Passo 2 - Raciocínio de IA
  let extraction: ExpenseExtraction;
  
  try {
    extraction = await extractExpense(message, options);
  } 
  catch (error) {
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

  // Passo 3 - Enriquecimento (lógica tradicional)
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

  // Passo 4 - Motor de regras (lógica tradicional)
  const decision = evaluateExpense({
    value: extraction.value,
    category: extraction.category,
  });

  // Resolve os tokens de papéis
  const approvers: ApproverAssignment[] = [];

  for (const role of decision.requiredApprovers) {
    if (role === "line_manager") {
      approvers.push({ role, employee: context.manager });
    } 
    else if (role === "finance_manager") {
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

  // Passo 5 - Constrói tarefas simuladas (mesmo formato das entradas do tasks.json).
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
 * Cria a lista de tickets que um sistema de ticketing posterior (ver tasks.json)
 * iria abrir. As tarefas são apenas impressas - nunca escritas no tasks.json.
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
