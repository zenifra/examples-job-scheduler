# Job agendado em Python

Verificador de disponibilidade em Python, usando só a biblioteca padrão. Veja o [README principal](../README.md) para entender o que o exemplo faz e como publicar na Zenifra.

## Na Zenifra

| Campo | Valor |
| --- | --- |
| **Diretório raiz** | `python` (ou `.` se a pasta for a raiz do repositório) |
| **Runtime** | Python |
| **Versão** | 3.11 ou mais recente |
| **Comando da tarefa** | `python -m uptime_job` |

A Zenifra instala as dependências do `requirements.txt`. Este exemplo não tem nenhuma, mas o arquivo fica pronto para as suas, com versões fixas.

## Estrutura

```text
uptime_job/
  __main__.py  ponto de entrada: liga o encerramento gracioso e define o código de saída
  shutdown.py  encerramento gracioso: SIGTERM/SIGINT, evento de parada e saída forçada
  main.py      a execução: configuração, verificações, estado, aviso e logs
  config.py    leitura e validação das variáveis de ambiente
  check.py     requisição com tempo limite e novas tentativas
  state.py     estado entre execuções no diretório persistente
tests/         testes com um servidor HTTP local
```

## Rodar localmente

```bash
TARGET_URLS=https://example.com python -m uptime_job
python -m unittest discover -s tests -t .
```
