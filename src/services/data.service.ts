/**
 * data.service.ts
 *
 * Pure TypeScript layer over the simulated HR database (employees.json).
 * No AI is used here - the LLM's output is only a hint that gets validated
 * against real data. If the person does not exist, we say so; we never
 * invent a manager or a department.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Employee, EmployeeContext } from "../types/expense.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EMPLOYEES_PATH = join(HERE, "..", "data", "employees.json");

let cache: Employee[] | null = null;

/**
 * Load the employee directory. Cached after the first read so repeated CLI
 * prompts do not hit disk again.
 */
export async function loadEmployees(): Promise<Employee[]> {
  if (cache) return cache;
  const raw = await readFile(EMPLOYEES_PATH, "utf8");
  cache = JSON.parse(raw) as Employee[];
  return cache;
}

/**
 * Accent- and case-insensitive comparison, so "carolina mendes" matches
 * "Carolina Mendes" and "Ines Almeida" matches "Inês Almeida".
 */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Find an employee by (possibly partial) name. Returns null when no match or
 * more than one match is found - the caller must then ask for clarification
 * instead of guessing.
 */
export async function findEmployeeByName(
  name: string,
): Promise<Employee | null> {
  const employees = await loadEmployees();
  const target = normalize(name);

  const exact = employees.filter((e) => normalize(e.name) === target);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const partial = employees.filter((e) => {
    const n = normalize(e.name);
    return n.includes(target) || target.includes(n);
  });
  return partial.length === 1 ? partial[0] : null;
}

export async function findEmployeeById(
  id: string,
): Promise<Employee | null> {
  const employees = await loadEmployees();
  return employees.find((e) => e.id === id) ?? null;
}

/**
 * Locate the current Finance Manager (used for approvals above 500 EUR).
 * Deterministic role lookup; not dependent on any LLM output.
 */
export async function findFinanceManager(): Promise<Employee | null> {
  const employees = await loadEmployees();
  return (
    employees.find(
      (e) => e.role === "Finance Manager" && e.status === "active",
    ) ?? null
  );
}

/**
 * Operations contact used to validate IT-equipment purchases.
 *
 * The sample tasks.json assigns the "validate stock before monitor purchase"
 * ticket (T107) to E002 (Bruno Costa, Operations Specialist), so we prefer an
 * active Operations Specialist and fall back to the Head of Operations.
 */
export async function findOperationsContact(): Promise<Employee | null> {
  const employees = await loadEmployees();
  const specialist = employees.find(
    (e) =>
      e.team === "Operations" &&
      e.role === "Operations Specialist" &&
      e.status === "active",
  );
  if (specialist) return specialist;
  return (
    employees.find(
      (e) => e.team === "Operations" && e.status === "active",
    ) ?? null
  );
}

/**
 * Build the full enrichment context for a given employee name: the employee
 * themselves, their line manager, and the two role-based contacts that the
 * policy engine may need to resolve.
 */
export async function buildEmployeeContext(
  employeeName: string,
): Promise<EmployeeContext | null> {
  const employee = await findEmployeeByName(employeeName);
  if (!employee) return null;

  const manager = employee.manager_id
    ? await findEmployeeById(employee.manager_id)
    : null;

  const [financeManager, operationsContact] = await Promise.all([
    findFinanceManager(),
    findOperationsContact(),
  ]);

  return { employee, manager, finance_manager: financeManager, operations_contact: operationsContact };
}

/** Testing hook: clear the in-memory cache. */
export function _resetEmployeeCache(): void {
  cache = null;
}
