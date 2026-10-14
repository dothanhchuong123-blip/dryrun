# Market Digital Twin

A multi-agent market and supply-chain simulator. Agents running **NVIDIA Nemotron** models on **Nebius Token Factory** make the business decisions, a deterministic NumPy/SciPy engine computes every market outcome, and **Tavily** grounds each shock in live news.

Built for the Nebius x NVIDIA Global AI Hackathon (Best Apps and Agents track).

> Work in progress. A full README with the architecture, setup steps and benchmarks is coming before submission.

## Quickstart (dev)

```bash
cp .env.example .env   # add NEBIUS_API_KEY and TAVILY_API_KEY
uv sync
uv run pytest
uv run uvicorn backend.main:app --reload
```

## License

MIT, see [LICENSE](LICENSE).
