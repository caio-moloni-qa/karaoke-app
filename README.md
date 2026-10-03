# Karaoke App

Karaoke caseiro inspirado num app que o streamer FunkyBlackCat "vibe-codou" com o
Claude: em vez de covers genéricos de YouTube, ele pega a música **original**,
separa os vocais em stems via GPU, e deixa misturar instrumental / vocal
principal / backing vocal na hora. Convidados adicionam músicas à fila pelo
celular; a TV/monitor mostra o palco com o mixer e a letra.

Tudo roda numa máquina só (o "host", de preferência com placa NVIDIA): app
web, banco de dados (Supabase local, em Docker), worker de processamento e a
biblioteca de áudio. Os amigos só abrem o app no navegador, na mesma rede
Wi-Fi. Plano e decisões: [docs/portable-architecture.md](docs/portable-architecture.md).

## Uso no dia a dia

| | |
|---|---|
| **Ligar tudo** | dois cliques em `start.cmd` — sobe Docker, banco, app e worker, e mostra os endereços do palco e do controle |
| **Desligar** | `stop.cmd` (os dados ficam guardados; música interrompida volta pra fila) |
| **Entrar na sala** | escanear o QR code do palco pelo celular |
| **Logs** | pasta `logs\` |

## Primeira instalação (Windows)

1. Instale o que faltar (o setup avisa o que está faltando):
   `winget install OpenJS.NodeJS.LTS Python.Python.3.11 Gyan.FFmpeg Docker.DockerDesktop`
   e o driver da NVIDIA, se tiver placa. Reinicie o Windows depois do Docker.
2. `.\scripts\setup.ps1` — instala as dependências, cria o ambiente Python do
   worker (com PyTorch para GPU se houver NVIDIA), sobe o banco local e gera
   `apps\web\.env.local` e `apps\worker\.env`.
3. Preencha em `apps\web\.env.local`:
   - `YOUTUBE_API_KEY` — [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com),
     ative a "YouTube Data API v3" e crie uma API key;
   - `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` — [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard),
     crie um app marcando só "Web API" (a conta dona do app precisa ser Premium).
4. `start.cmd`.

`.\scripts\setup.ps1 -CheckOnly` só confere o que falta, sem mudar nada.

## Biblioteca de áudio em outro disco (ex.: HD externo)

O áudio processado fica em `apps\worker\storage\` por padrão. Para mudar:

```
stop.cmd
node scripts\move-library.mjs "E:\Karaoke"        (--dry-run só mostra o tamanho)
start.cmd
```

O script copia tudo, confere arquivo por arquivo e aponta o app para a pasta
nova (`STEMS_STORAGE_DIR` em `apps\web\.env.local`). A cópia antiga fica onde
estava, para você apagar quando quiser. Se o HD estiver desconectado, o
controle mostra um aviso e o worker espera em vez de processar músicas que não
teria onde salvar. No PC host, cada música em "Já prontas" tem um botão para
abrir a pasta dela.

## Levar para outra máquina

```
.\scripts\backup.ps1 -Destination E:\KaraokeBackups [-IncludeAudio]
```

Gera uma pasta com o banco (`database.sql`) e as configurações (que contêm as
chaves do app — guarde em lugar privado). Na máquina nova, depois do
`setup.ps1`:

```
.\scripts\restore.ps1 -Backup E:\KaraokeBackups\karaoke-backup-<data> [-AudioDir E:\Karaoke]
```

## Estrutura

- `apps/web` — Next.js (App Router): palco, controle, API.
- `apps/worker` — worker Python (GPU): baixa do YouTube, separa os stems,
  detecta tom/escala. Ver `apps/worker/README.md`.
- `supabase/` — config do Supabase local, migrations e dados de demo.
- `scripts/` — setup, start/stop, backup/restore, mover biblioteca.
- `docs/` — plano da arquitetura portátil e formato de importação CSV.

## Histórico

1. **MVP1** — palco + controle remoto + fila em tempo real.
2. **MVP2** — worker (`yt-dlp` + separação em 2 estágios na GPU + tom/escala)
   e busca no YouTube.
3. **MVP3** — letra sincronizada (LRCLIB) e arte de fundo (iTunes API).
4. **MVP4** — QR code no palco, status do worker, tela cheia.
5. Depois: importação por Spotify / CSV, fila de processamento, áudio local,
   banco local (Supabase em Docker) e scripts de start/stop/backup.
