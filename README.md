# Exemplos de Jobs agendados na Zenifra

Exemplos prontos para usar como ponto de partida de um [Job agendado](https://docs.zenifra.com/pt/docs/scheduled-jobs) na Zenifra, em três runtimes:

| Pasta | Runtime | Comando da tarefa |
| --- | --- | --- |
| [`nodejs/`](nodejs) | Node.js 22 ou mais recente | `exec node src/index.js` |
| [`bun/`](bun) | Bun 1.2 ou mais recente | `exec bun run src/index.ts` |
| [`python/`](python) | Python 3.11 ou mais recente | `exec python -m uptime_job` |

Os três fazem a mesma coisa, do mesmo jeito: escolha a linguagem que você já usa e copie a pasta para o seu repositório.

## O que o exemplo faz

É um verificador de disponibilidade. A cada execução, ele:

1. acessa cada URL de `TARGET_URLS`, com tempo limite por requisição e novas tentativas quando a resposta indica uma falha temporária;
2. registra o resultado de cada URL nos logs, em JSON (uma linha por evento);
3. compara com a execução anterior, se houver um diretório persistente, e identifica quem caiu ou voltou;
4. avisa um webhook (Slack, Discord com `/slack` no fim da URL, n8n ou o seu próprio endpoint) quando algo está fora do ar ou mudou;
5. termina com um código de saída que diz se a execução deu certo.

O verificador é só a desculpa. O que vale copiar é a estrutura em volta dele, que serve para qualquer rotina: relatórios, limpezas, sincronizações, backups e afins.

## Boas práticas aplicadas

- **Termina sozinho.** Um Job não é um servidor: ele roda, faz o trabalho e sai. Não abre porta nem fica esperando requisições.
- **O código de saída diz o resultado.** `0` aparece como **Concluída** no Console; qualquer outro valor aparece como **Falhou**. O exemplo usa `1` para falha da tarefa e `2` para configuração inválida.
- **Valida a configuração antes de começar.** Uma variável de ambiente errada falha na hora, com uma mensagem clara, em vez de quebrar no meio do trabalho.
- **Encerra com elegância.** Ao cancelar uma execução, pausar ou excluir o Job, a Zenifra envia `SIGTERM` e espera até 30 segundos. O exemplo interrompe o que está fazendo, registra o cancelamento e sai em menos de um segundo.
- **Usa `exec` no comando da tarefa.** Assim o processo da sua tarefa recebe o `SIGTERM` diretamente, sem um shell no meio que poderia engolir o sinal.
- **Tem prazo próprio.** Toda execução é encerrada pela Zenifra após 60 minutos. O exemplo tem um prazo interno menor (`JOB_DEADLINE_SECONDS`), para registrar o que aconteceu e sair por conta própria.
- **Toda requisição tem tempo limite.** Uma chamada de rede presa não segura a execução (e a cobrança) até o limite.
- **Tenta de novo só quando vale a pena**, com espera exponencial e um pouco de aleatoriedade. Um `404` não melhora na segunda tentativa; um `503` pode melhorar.
- **Limita a concorrência.** Verifica várias URLs ao mesmo tempo, mas sem passar de `CONCURRENCY`.
- **Logs estruturados.** Uma linha JSON por evento, em `stdout`, e erros em `stderr`. Fica fácil ler em **Ver logs** e filtrar depois.
- **Nunca registra segredos.** A URL do webhook costuma carregar um token, então o log mostra só o host.
- **Estado opcional e seguro.** O estado entre execuções fica no diretório persistente e é gravado num arquivo temporário renomeado ao final, para nunca ficar pela metade. Se o diretório não estiver disponível, a verificação continua e o problema aparece no log.
- **Cabe no menor plano.** O pico de memória medido fica em cerca de 20 MiB no Node.js, 25 MiB no Python e menos de 10 MiB no Bun, folgado para os 64 MiB do Job Starter. No Node.js, o exemplo usa `node:https` em vez de `fetch`: o `fetch` carrega o undici e mais que dobra a memória, o que basta para a tarefa ser encerrada por falta de memória num plano pequeno.
- **Sem dependências externas.** O build fica mais rápido e há menos coisas para manter atualizadas. Quando precisar de bibliotecas, fixe as versões (lockfile no Node e no Bun, versões exatas no `requirements.txt`).
- **Testado.** Cada pasta tem testes que sobem um servidor HTTP local, sem depender da internet.

## Como publicar na Zenifra

1. Copie a pasta da linguagem escolhida para um repositório seu no GitHub (pode ser na raiz ou numa subpasta).
2. No [Console](https://console.zenifra.com), clique em **Criar projeto** e escolha **Job agendado**.
3. Escolha o plano e dê um nome ao projeto.
4. Em **Configurar Job agendado**:
   - **Origem da tarefa:** **Repositório GitHub**, e selecione o repositório e a **Branch**;
   - **Diretório raiz:** a pasta onde o exemplo está (por exemplo, `nodejs`) ou `.` se ele estiver na raiz;
   - **Runtime** e **Versão:** os da tabela acima;
   - **Comando da tarefa:** o da tabela acima;
   - **Expressão cron:** por exemplo, `*/15 * * * *` para rodar a cada 15 minutos (sempre em UTC).
5. Para comparar uma execução com a anterior, ative **Manter dados entre execuções**, use `/data` como **Diretório persistente** e adicione a variável `STATE_DIR=/data`.
6. Em **Variáveis de Ambiente**, adicione pelo menos `TARGET_URLS`.
7. Clique em **Criar Job**. A Zenifra faz o build do repositório e executa a tarefa nos horários definidos.

Cada execução aparece no card **Execuções** do projeto, com status, duração, minutos cobrados e o botão **Ver logs**.

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `TARGET_URLS` | sim | — | URLs a verificar, separadas por vírgula (até 50). |
| `REQUEST_TIMEOUT_MS` | não | `10000` | Tempo limite de cada requisição, em milissegundos (100 a 20000). |
| `MAX_ATTEMPTS` | não | `3` | Tentativas por URL (1 a 5). Só repete em `408`, `425`, `429`, `5xx` e erros de rede. |
| `CONCURRENCY` | não | `5` | Quantas URLs verificar ao mesmo tempo (1 a 20). |
| `JOB_DEADLINE_SECONDS` | não | `300` | Prazo interno da execução, em segundos (10 a 3300). |
| `FAIL_ON_DOWN` | não | `true` | Com `true`, a execução falha (código 1) se alguma URL estiver fora do ar. |
| `WEBHOOK_URL` | não | — | Recebe um `POST` com `{"text": "..."}` quando há URLs fora do ar ou mudanças desde a execução anterior. |
| `STATE_DIR` | não | — | Diretório para guardar o estado entre execuções. Use o mesmo **Diretório persistente** do Job. |

O tempo limite por requisição vai até 20 segundos para que uma requisição em andamento sempre termine dentro dos 30 segundos de encerramento.

## Códigos de saída

| Código | Significado | No Console |
| --- | --- | --- |
| `0` | Todas as URLs responderam (ou `FAIL_ON_DOWN=false`). | **Concluída** |
| `1` | Alguma URL fora do ar, webhook com erro, prazo interno excedido ou execução interrompida. | **Falhou** |
| `2` | Configuração inválida. | **Falhou** |

## Rodar localmente

Veja o README de cada pasta. Em todas, o teste rápido é o mesmo:

```bash
TARGET_URLS=https://example.com <comando da tarefa>
echo $?
```

## Licença

[MIT](LICENSE)
