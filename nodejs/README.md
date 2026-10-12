# Job agendado em Node.js

Verificador de disponibilidade em Node.js, sem dependências externas. Veja o [README principal](../README.md) para entender o que o exemplo faz e como publicar na Zenifra.

## Na Zenifra

| Campo | Valor |
| --- | --- |
| **Diretório raiz** | `nodejs` (ou `.` se a pasta for a raiz do repositório) |
| **Runtime** | Node.js |
| **Versão** | 22 ou mais recente |
| **Comando da tarefa** | `exec node src/index.js` |

A Zenifra instala as dependências com `npm ci`, então mantenha o `package-lock.json` no repositório.

## Estrutura

```text
src/
  index.js    ponto de entrada: sinais de parada e código de saída
  main.js     a execução: configuração, verificações, estado, aviso e logs
  config.js   leitura e validação das variáveis de ambiente
  check.js    requisição com tempo limite, novas tentativas e concorrência
  state.js    estado entre execuções no diretório persistente
test/         testes com um servidor HTTP local
```

## Rodar localmente

```bash
npm ci
TARGET_URLS=https://example.com node src/index.js
npm test
```
