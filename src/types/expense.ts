/**
 * Shared types for the Controlo de Despesas agent.
 *
 * Field names in the extraction payload follow the exact contract requested in
 * the challenge brief (employee_name, item, value_in_EUR, assumed_category).
 * The category is a closed enum so the LLM cannot invent a free-text label.
 */

export const EXPENSE_CATEGORIES = [
  "Equipamento informático",
  "Outros",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * Structured output produced by the LLM step (or the local fallback).
 * This is the ONLY thing the LLM is allowed to produce - no approval logic.
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
 * Result of the deterministic enrichment step. `manager` may be null when the
 * employee has no line manager (e.g. Managing Director), which the agent
 * surfaces as a clarification instead of inventing an approver.
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
 * Pure output of the rules engine. It only names ROLES - resolving them to
 * concrete people happens in the orchestrator using the employee context.
 */
export interface PolicyDecision {
  requiredApprovers: ApproverRole[];
  requiredValidators: ValidatorRole[];
  registerInSystem: boolean;
  reasons: string[];
}

/**
 * A simulated ticket, shaped to match the entries in tasks.json so the CLI
 * output looks like real work that would be created downstream.
 */
export interface SimulatedTask {
  id: string;
  title: string;
  category: "expense";
  assignee_id: string;
  status: "open";
  amount: number;
}
