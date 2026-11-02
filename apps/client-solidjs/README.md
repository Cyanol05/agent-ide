# client-solidjs

A hello-world Vite + SolidJS 2 (RC) app. A first step toward a client with reactivity and components; apps/client is untouched.

    pnpm install                # at the repo root; client-solidjs is a workspace package
    bun start                   # agent-ide on :3000
    pnpm --filter client-solidjs dev  # Vite on :5173, proxying /api to :3000 (or $PORT)
