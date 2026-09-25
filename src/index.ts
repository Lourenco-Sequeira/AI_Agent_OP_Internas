/**
 * index.ts
 *
 * CLI entry point for the "Controlo de Despesas" agent.
 *
 * Uses Node's native `readline` to loop on user input, delegates all logic to
 * expense.agent.ts, and prints a user-friendly Portuguese summary of the
 * resulting approval flow.
 *
 * Type `sair` (or press Ctrl+C) to exit.
 */

import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { processExpenseMessage, type AgentResult } from "./agent/expense.agent.js";

async function main(): Promise<void> {
  printBanner();

  const rl = createInterface({ input, output });

  // Loop: read one line = one expense claim. Empty line or "sair" exits.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let line: string;
    try {
      line = (await rl.question("\n> Mensagem (ou 'sair'): ")).trim();
    } catch {
      // readline closed (Ctrl+C, EOF, etc.)
      break;
    }

    if (line === "" || line.toLowerCase() === "sair" || line.toLowerCase() === "exit") {
      break;
    }

    try {
      const result = await processExpenseMessage(line);
      renderResult(result);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`\n[erro] ${detail}`);
    }
  }

  rl.close();
  console.log("\nAté já.");
}

function printBanner(): void {
  const hasKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  console.log("========================================");
  console.log(" Esclarecimento de Despesas — Agente CLI");
  console.log("========================================");
  console.log("");
  console.log(
    ` Modelo LLM: ${hasKey ? "Gemini (" + (process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite") + ")" : "Erro ao carregar o modelo Gemini"}`,
  );
  console.log("");
  console.log(" Escreva uma mensagem de despesas em linguagem natural.");
  console.log(" Exemplo: 'A Carolina Mendes pediu um monitor de 420 EUR. Como deve proceder?'");
}

function renderResult(result: AgentResult): void {
  console.log("\n----------------------------------------");

  if (!result.ok) {
    console.log(" [Necessita de intervenção humana]");
    
    if (result.extraction) {
      console.log("");
      console.log(" Extração da mensagem:");
      console.log(`   - Colaborador: ${result.extraction.employee_name}`);
      console.log(`   - Item: ${result.extraction.item}`);
      console.log(`   - Valor: ${formatEUR(result.extraction.value)}`);
      console.log(`   - Categoria: ${result.extraction.category}`);
    }
    console.log("");
    console.log(` Motivo: ${result.reason}`);
    console.log("----------------------------------------");
    return;
  }

  const { extraction, context, decision, approvers, validators, tasks } = result;

  console.log(" Resumo do pedido");
  console.log(`   - Colaborador: ${context.employee.name} (${context.employee.id}, ${context.employee.team})`);
  console.log(`   - Item: ${extraction.item}`);
  console.log(`   - Valor: ${formatEUR(extraction.value)}`);
  console.log(`   - Categoria: ${extraction.category}`);

  console.log("\n Decisão da política de despesas");
  for (const reason of decision.reasons) {
    console.log(`   - ${reason}`);
  }
  console.log(`   - Registo no sistema de despesas: ${decision.registerInSystem ? "sim" : "não"}`);

  console.log("\n Aprovações necessárias");
  if (approvers.length === 0) {
    console.log("   - (nenhum)");
  } else {
    for (const a of approvers) {
      console.log(
        `   - [${labelForRole(a.role)}] ${a.employee.name} (${a.employee.id}, ${a.employee.role})`,
      );
    }
  }

  console.log("\n Validações necessárias");
  if (validators.length === 0) {
    console.log("   - (nenhum)");
  } else {
    for (const v of validators) {
      console.log(
        `   - [${labelForRole(v.role)}] ${v.employee.name} (${v.employee.id}, ${v.employee.role})`,
      );
    }
  }

  console.log("\n Tarefas a realizar");
  for (const t of tasks) {
    console.log(`   - ${t.id} | ${t.title} | assignee=${t.assignee_id} | ${formatEUR(t.amount)}`);
  }

  console.log("----------------------------------------");
}

function labelForRole(role: string): string {
  switch (role) {
    case "line_manager":
      return "Line Manager";
    case "finance_manager":
      return "Finance Manager";
    case "operations":
      return "Operations";
    default:
      return role;
  }
}

function formatEUR(value: number): string {
  return `${value.toLocaleString("pt-PT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} EUR`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
