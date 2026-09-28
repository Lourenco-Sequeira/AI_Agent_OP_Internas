/**
 * Nomes dos campos no payload de extração seguem o exato contrato solicitado no desafio (employee_name, item, value_in_EUR, assumed_category).
 * A categoria é um enum fechado para que o LLM não invente uma etiqueta de texto livre.
 */

export const EXPENSE_CATEGORIES = [
  "Equipamento informático",
  "Outros",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * Saída estruturada produzida pelo passo do LLM.
 * Isto é a única coisa que o LLM tem permissão para produzir - sem lógica de aprovação.
 */
export interface ExpenseExtraction {
  is_expense: boolean;
  employee_name: string;
  item: string;
  value: number;
  category: ExpenseCategory;
}

export interface Employee {
  id: string;
  name: string;
  team: string;
  role: string;
  manager_id: string | null;
  location: string;
  employment_type: string;
  status: string;
  start_date?: string;
}

/**
 * Resultado do passo determinístico de enriquecimento. `manager` pode ser nulo quando o
 * colaborador não tem um line manager (Managing Director), o que o agente
 * apresenta como um pedido de clarificação em vez de inventar um aprovador.
 */
export interface EmployeeContext {
  employee: Employee;
  manager: Employee | null;
  finance_manager: Employee | null;
  operations_contact: Employee | null;
}

export type ApproverRole = "line_manager" | "finance_manager";
export type ValidatorRole = "operations";

/**
 * Saída pura do motor de regras. Apenas nomeia os papéis - resolvê-los para
 * pessoas concretas acontece no orquestrador utilizando o contexto do colaborador.
 */
export interface PolicyDecision {
  requiredApprovers: ApproverRole[];
  requiredValidators: ValidatorRole[];
  registerInSystem: boolean;
  reasons: string[];
}

/**
 * Um ticket simulado, formatado para corresponder às entradas no tasks.json para que o output
 * do CLI pareça trabalho real que seria criado num sistema posteriormente.
 */
export interface SimulatedTask {
  id: string;
  title: string;
  category: "expense";
  assignee_id: string;
  status: "open";
  amount: number;
}
