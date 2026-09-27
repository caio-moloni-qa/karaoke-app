# Karaoke App

Karaoke caseiro inspirado num app que o streamer FunkyBlackCat "vibe-codou" com o
Claude: em vez de covers genéricos de YouTube, ele pega a música **original**,
separa os vocais em stems via GPU, e deixa misturar instrumental / vocal
principal / backing vocal na hora. Convidados adicionam músicas à fila pelo
celular; a TV/monitor mostra o palco com o mixer e a letra.

Arquitetura híbrida: o app (`apps/web`) fica na nuvem (Vercel + Supabase) para
poder ser acessado de qualquer lugar; o processamento pesado (download +
separação de stems, que precisa de GPU) roda num worker local na sua máquina,
que faz polling na API do app em vez de expor porta nenhuma.

## Estrutura

- `apps/web` — Next.js (App Router). Ver `apps/web/README.md`.
- `apps/worker` — worker Python local (GPU). Ver `apps/worker/README.md`.
- `supabase/migrations` — schema do Postgres.
- `supabase/seed.sql` — dados de demonstração para testar a MVP1 sem worker.

## Roteiro de MVPs

1. **MVP1** — palco + controle remoto + fila em tempo real, com uma música
   semeada manualmente (sem busca no YouTube nem worker ainda).
2. **MVP2** (atual) — worker real (`yt-dlp` + separação de stems em 2 estágios
   via GPU + detecção de tom/escala) e busca de música no YouTube pelo
   remote, com preview de 5s do meio da música.
3. **MVP3** — letra sincronizada (LRCLIB) e arte de fundo (iTunes API).
4. **MVP4** — entrada de sala via QR code, indicador de worker online/offline,
   modo tela cheia.

## Setup (MVP1)

1. Crie um projeto no [Supabase](https://supabase.com) e rode as migrations em
   `supabase/migrations/` (SQL editor do Studio, ou `supabase db push` se
   tiver a CLI linkada ao projeto).
2. Em Storage, confirme que o bucket privado `stems` foi criado pela migration
   `0002_storage.sql`. Faça upload manual de 3 arquivos de áudio de teste na
   raiz do bucket (`instrumental.mp3`, `lead_vocal.mp3`,
   `backing_vocal.mp3`) — qualquer trecho curto serve para testar o mixer.
3. Rode `supabase/seed.sql` (SQL editor do Studio) para criar a sala e a
   música de demonstração.
4. Copie `apps/web/.env.example` para `apps/web/.env.local` e preencha com as
   chaves do projeto (Settings → API): URL, `anon` key e `service_role` key.
5. `cd apps/web && npm install && npm run dev` e abra `http://localhost:3000`.
   A home lista a sala de demo com links para `/stage/<roomId>` (a "TV") e
   `/room/<roomId>` (o controle — abra pelo celular na mesma rede, ou em outra
   aba do navegador).

## Setup (MVP2 — busca no YouTube + worker)

1. Gere uma `YOUTUBE_API_KEY` no [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
   (ative a "YouTube Data API v3" e crie uma API key) e defina uma
   `WORKER_API_KEY` própria (qualquer string longa e aleatória — é o segredo
   compartilhado entre o worker e o app). Preencha as duas em
   `apps/web/.env.local`.
2. Rode `alter publication supabase_realtime add table songs;` no SQL Editor
   do Supabase (além do `queue_items` da MVP1) — o remote e o palco agora
   também escutam mudanças de status em `songs`.
3. Siga `apps/worker/README.md` para configurar o worker Python (venv com
   Python 3.11, ffmpeg, dependências, `.env`) e rode `python worker.py`.
4. No `/room/<roomId>`, busque uma música no YouTube, ouça o preview de 5s e
   adicione à fila — o worker vai baixar, separar os stems e marcar a música
   como pronta; o palco mostra o status até lá.
