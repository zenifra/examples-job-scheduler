# Job agendado em Bun

Verificador de disponibilidade em Bun e TypeScript, sem dependências de execução. Veja o [README principal](../README.md) para entender o que o exemplo faz e como publicar na Zenifra.

## Na Zenifra

| Campo | Valor |
| --- | --- |
| **Diretório raiz** | `bun` (ou `.` se a pasta for a raiz do repositório) |
| **Runtime** | Bun |
| **Versão** | 1.2 ou mais recente |
| **Comando da tarefa** | `bun run src/index.ts` |

A Zenifra instala as dependências com `bun install --frozen-lockfile`, então mantenha o `bun.lock` no repositório. O Bun executa TypeScript diretamente, sem etapa de build.

## Estrutura

```text
src/
  index.ts    ponto de entrada: sinais de parada e código de saída
  main.ts     a execução: configuração, verificações, estado, aviso e logs
  config.ts   leitura e validação das variáveis de ambiente
  check.ts    requisição com tempo limite, novas tentativas e concorrência
  state.ts    estado entre execuções no diretório persistente
test/         testes com um servidor HTTP local
```

## Rodar localmente

```bash
bun install
TARGET_URLS=https://example.com bun run src/index.ts
bun test
bun run typecheck
```
