# @dr-abc/desktop

Tauri 2 wrapper for Dr.ABC. Adds:

- Local Ollama orchestration without the user starting Docker
- Native window chrome with bioluminescent theming
- Wake-word listener (Porcupine) running in a Rust sidecar
- ~3 MB binary vs Electron's 80 MB+

## Setup (Phase 7)

```bash
cd apps/desktop
bun add -d @tauri-apps/cli@^2
bunx tauri init
bunx tauri dev
```

Wraps `apps/web` automatically when configured to point at `http://localhost:5173`.
