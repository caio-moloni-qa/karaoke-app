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
- `apps/worker` — worker Python local (GPU), a partir da MVP2.
- `supabase/migrations` — schema do Postgres.
- `supabase/seed.sql` — dados de demonstração para testar a MVP1 sem worker.

## Roteiro de MVPs

1. **MVP1** (atual) — palco + controle remoto + fila em tempo real, com uma
   música semeada manualmente (sem busca no YouTube nem worker ainda).
2. **MVP2** — worker real (`yt-dlp` + separação de stems + detecção de
   tom/escala) e busca de música no YouTube pelo remote.
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

`YOUTUBE_API_KEY` e `WORKER_API_KEY` só passam a ser necessárias na MVP2.
