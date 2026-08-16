# GeneCode

GeneCode is a local-first molecular sequence and cloning workbench with an
integrated Agent. It combines a React + Tauri desktop interface, the vendored
GeneCode OVE sequence editor, and a Python sidecar for deterministic biology
tools and optional model-assisted task routing.

![CI](https://github.com/zjuphD/GeneCode/actions/workflows/ci.yml/badge.svg)

## Highlights

- Circular, linear, sequence, and split sequence-editor views
- GenBank/FASTA import, annotations, restriction sites, selections, and history
- Agent conversation history and visible execution-step flow
- Editor-aware Agent context for the open document and selected region
- Molecular cloning, RT-qPCR, sgRNA, siRNA, and mutagenesis workflows
- Local deterministic calculations with optional OpenAI-compatible model support
- Tauri desktop shell with a token-protected local Python API

## Repository layout

```text
.
├── molecular-design-studio/   # React, Tauri, and GeneCode OVE frontend
├── server.py                  # Local Agent/API entry point
├── server_pkg/                # Python Agent and biology implementation
├── tests/                     # Python regression and security tests
└── .github/workflows/ci.yml   # Frontend and backend CI
```

The root `index.html` and `assets/` preserve the browser-based Primer Design
Studio compatibility page served by `server.py`.

## Requirements

- Node.js 22+
- npm 10+
- Python 3.11+
- Rust stable and platform build tools for the Tauri desktop application

## Desktop development

```bash
git clone https://github.com/zjuphD/GeneCode.git
cd GeneCode/molecular-design-studio
npm install
npm run tauri:dev
```

Tauri reuses a healthy Agent service on `127.0.0.1:8000`, or starts the
repository's `server.py` sidecar automatically.

## Browser development

Use the same local token on the backend and frontend:

```bash
# terminal 1
GENE_CODE_API_TOKEN=dev-token python3 server.py --port 8000

# terminal 2
cd molecular-design-studio
VITE_AGENT_API_TOKEN=dev-token npm run dev
```

Then open `http://127.0.0.1:1420`.

## Optional model configuration

The deterministic biology tools work without a model. To enable an
OpenAI-compatible provider, configure it on the local backend only:

```bash
export AGENT_LLM_ENABLED=1
export AGENT_LLM_API_KEY="your-key"
export AGENT_LLM_MODEL="your-model"
export AGENT_LLM_BASE_URL="https://provider.example/v1"
```

Do not put API keys in frontend source files or commit `.env` files.

## Verification

```bash
cd molecular-design-studio
npm run typecheck
npm run lint
npm test -- --run
npm run build
npm run build:agent-sidecar
cargo check --manifest-path src-tauri/Cargo.toml

cd ..
AGENT_LLM_ENABLED=0 python3 -m unittest discover -s tests -p "test_*.py"
```

GitHub Actions runs the same frontend and backend quality gates on every push
and pull request.
