/**
 * data.service.ts
 *
 * Camada de TypeScript puro sobre a base de dados simulada de RH (employees.json).
 * Nenhuma IA é usada aqui - a saída do LLM é apenas uma pista que é validada
 * com dados reais. Se a pessoa não existir, é dito; não se inventam um manager ou um departamento.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Employee, EmployeeContext } from "../types/expense.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EMPLOYEES_PATH = join(HERE, "..", "data", "employees.json");

let cache: Employee[] | null = null;

/**
 * Carrega o diretório de colaboradores. Fica em cache após a primeira leitura para que
 * os prompts repetidos do CLI não leiam o disco novamente.
 */
export async function loadEmployees(): Promise<Employee[]> {
  if (cache) return cache;
  const raw = await readFile(EMPLOYEES_PATH, "utf8");
  cache = JSON.parse(raw) as Employee[];
  return cache;
}

/**
 * Comparação insensível a acentos e maiúsculas/minúsculas, para que "carolina mendes" corresponda a
 * "Carolina Mendes" e "Ines Almeida" corresponda a "Inês Almeida".
 */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Encontra um colaborador pelo nome (possivelmente parcial). Retorna null quando não há correspondência ou
 * mais de uma correspondência é encontrada - o chamador deve então pedir clarificação em vez de tentar adivinhar.
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
 * Localiza o atual Finance Manager (usado para aprovações acima de 500 EUR).
 * Pesquisa determinística de papel; não depende de nenhuma saída do LLM.
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
 * Contacto de Operations usado para validar compras de equipamento informático.
 *
 * O tasks.json de exemplo atribui o ticket "validar stock antes de comprar monitor"
 * (T107) a E002 (Bruno Costa, Operations Specialist), por isso uso o Operations Specialist ativo e o Head of Operations como alternativa.
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
 * Constrói o contexto completo para o nome de um determinado colaborador: o próprio
 * colaborador, o seu line manager e os dois contactos baseados em papéis que o
 * motor de regras pode precisar de resolver.
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

/** Limpa a cache em memória. */
export function _resetEmployeeCache(): void {
  cache = null;
}
