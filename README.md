# evorun

This is me messing around with automatic optimization with LLMs, based on [MLEvolve](https://github.com/InternScience/MLEvolve) but with claude and standard project structure.

## Project structure

```
my_project/
├── experiment/   # code the LLM edits
├── eval.py       # prints {"score": <float>} to stdout
├── TASK.md       # describes the task and objective
└── config.toml   # optional, see config.example.toml
```

## Commands

- `evorun run` — run the optimization loop on a project directory
- `evorun viz` — start the web visualization server to inspect the search tree
- `evorun init` — scaffold a new project with starter config, TASK.md, and eval.py
- `evorun restore` — restore the codebase from a snapshot (best, root, or specific node)
- `evorun tree` — print a tree summary of the run with scores and edit summaries
- `evorun history` — print iterations in chronological order with scores and edit summaries
