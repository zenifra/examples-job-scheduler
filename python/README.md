# Job agendado em Python

Verificador de disponibilidade em Python, usando só a biblioteca padrão. Veja o [README principal](../README.md) para entender o que o exemplo faz e como publicar na Zenifra.

## Na Zenifra

| Campo | Valor |
| --- | --- |
| **Diretório raiz** | `python` (ou `.` se a pasta for a raiz do repositório) |
| **Runtime** | Python |
| **Versão** | 3.11 ou mais recente |
| **Comando da tarefa** | `exec python -m uptime_job` |

A Zenifra instala as dependências do `requirements.txt`. Este exemplo não tem nenhuma, mas o arquivo fica pronto para as suas, com versões fixas.

O `exec` é importante: sem ele, um shell fica como processo principal e não repassa o `SIGTERM`, e a tarefa não consegue encerrar com elegância quando a execução é cancelada.

## Estrutura

```text
uptime_job/
  __main__.py  ponto de entrada: sinais de parada e código de saída
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
