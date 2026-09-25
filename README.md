# Esclarecimento de Despesas - AI Agent para Operações Internas

Protótipo em CLI que recebe um pedido de despesa em linguagem natural, identifica o colaborador, aplica a política interna e devolve os aprovadores, os validadores e as tarefas que seriam abertas.

## Como identifiquei o problema

Nos dados do desafio, mensagens simples de esclarecimento de dúvidas passam por chat: perceber a política de despesas, saber quem aprova e abrir a tarefa. Escolhi as despesas porque `expenses_policy.md` tem regras fechadas e `messages.json` tem um pedido real desse tipo (a Carolina Mendes, monitor de 420 EUR). Para além disso, tratando-se de uma área prioritária (sem equipamento informático os colaboradores não conseguem trabalhar, e se não estiver nas melhores condições a sua produtividade baixa), os processos de esclarecimento de dúvidas e criação de tarefas devem ser eficientes e assertivos.

## Onde faz sentido utilizar AI

A AI entra na leitura e interpretação da mensagem. O agente extrai:

- `is_expense`
- `employee_name`
- `item`
- `value`
- `category` (`Equipamento informático` ou `Outros`)

Isto está em `src/services/llm.service.ts`. A temperatura é 0 e a resposta tem de cumprir um esquema JSON. O modelo não escolhe aprovadores nem aplica a política.

## Onde utilizo lógica tradicional

Tudo o que envolve acesso a dados estruturados e segurança fica em TypeScript:

- procurar o colaborador, o manager, a Finance Manager e o contacto de Operations em `src/data/employees.json`;
- aplicar os escalões de valor e a regra de equipamento informático em `src/services/policy.service.ts`;
- criar as tarefas simuladas em `src/agent/expense.agent.ts`.

Regras em vigor no protótipo:

- abaixo de 100 EUR: aprovação do line manager;
- de 100 a 500 EUR: line manager e registo no sistema;
- acima de 500 EUR: line manager, Finance Manager e registo no sistema;
- equipamento informático: validação de Operations, em qualquer valor.

Os escalões estão no código para a decisão de cada pedido ser repetível. Num contexto real, esses limites passariam a ser lidos de `expenses_policy.md` sempre que o ficheiro mudasse, mas continuariam a ser aplicados por TypeScript e não pelo modelo.

## Ferramentas do agente

O orquestrador usa três ferramentas. O modelo não as escolhe.


| Ferramenta                 | O que faz                                         | Onde                             |
| -------------------------- | ------------------------------------------------- | -------------------------------- |
| Diretório de colaboradores | Resolve a pessoa e os papéis                      | `src/services/data.service.ts`   |
| Política de despesas       | Decide aprovadores, validadores e registo         | `src/services/policy.service.ts` |
| Sistema de tarefas         | Monta tarefas abertas, no formato de `tasks.json` | `src/agent/expense.agent.ts`     |


As tarefas são impressas na CLI. O ficheiro `tasks.json` não é alterado. Calendário, onboarding e acessos ficam de fora porque não são necessários para este problema.

## Ações que exigem validação humana

O agente pára e não inventa um aprovador quando:

- a mensagem não é um pedido de despesa;
- a extração da mensagem falha;
- o pedido é uma despesa, mas o valor não foi indicado;
- o nome não corresponde a um único colaborador;
- o colaborador não tem line manager;



## Como evoluiria a solução num contexto real

1. Gravar as tarefas no sistema interno, em vez de as imprimir no CLI.
2. Pedir confirmação à pessoa atribuída, antes de abrir as tarefas.
3. Dar ao agente acesso de leitura a `expenses_policy.md` e, quando o ficheiro fosse atualizado, extrair os escalões para um objeto validado (por exemplo, um ficheiro *policy_config.json*). Essa extração exigiria confirmação humana antes de entrar em vigor. Cada pedido continuaria a ser decidido por `evaluateExpense` com esses valores, sem o modelo reler a política nem escolher aprovadores.
4. Tratar a exceção de despesa urgente (compra antes da aprovação, com justificação e regularização em dois dias úteis).
5. Ligar o chat interno, para o agente receber a mensagem sem ser colada na CLI.



## Como experimentar

Requer Node.js 18+, `GEMINI_API_KEY` e `GEMINI_MODEL` (configurar modelo) no `.env`. 

```bash
npm install
npm run dev
```

