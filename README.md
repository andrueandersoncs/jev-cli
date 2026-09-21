# jev-cli

A small Bun CLI for asking [TypeSafe AI](https://typesafe.ai/) typed questions about JSON state. It uses Effect CLI v4 for argument parsing and the TypeSafe JavaScript SDK for `choice`, `noul`, and `score` judgments.

## Requirements

- [Bun](https://bun.sh/)
- A TypeSafe API key

## Setup

Install dependencies:

```bash
bun install
```

Create a `.env` file in the project root:

```dotenv
TYPESAFE_API_KEY=your_api_key
```

Bun loads `.env` automatically. The file is ignored by Git.

Create a state file containing valid JSON. For example, `state.json`:

```json
{
  "health": 3,
  "enemy": "dragon",
  "inventory": ["smoke bomb"]
}
```

The top-level state may be a JSON string, object, array, or `null`.

## Usage

```text
jev <subcommand> [flags]
```

During development, invoke the executable through the package script:

```bash
bun run jev <subcommand> [flags]
```

Run `bun run jev --help` or `bun run jev <subcommand> --help` for generated Effect CLI help.

### Choice

Select one label from two or more alternatives:

```bash
bun run jev choice \
  --state ./state.json \
  --prompt "What should I do next?" \
  --choices run hide fight entice
```

Quote labels containing spaces:

```bash
bun run jev choice \
  --state ./state.json \
  --prompt "What should I do next?" \
  --choices "run away" "hide quietly" "fight the dragon"
```

The command prints only the selected label:

```text
hide quietly
```

`--choices` must be followed by at least two unique labels and should be the final flag in the command.

### Noul

Evaluate a yes-or-no question:

```bash
bun run jev noul \
  --state ./state.json \
  --prompt "Should I fight the dragon?"
```

The command prints the probability of **yes**, from `0` to `1`:

```text
0.11
```

A value near `0` favors no, a value near `1` favors yes, and a value near `0.5` indicates similar probability for both outcomes.

### Score

Evaluate the state against an ordered rubric:

```bash
bun run jev score \
  --state ./state.json \
  --prompt "How dangerous is this situation?" \
  --levels Safe Dangerous "Life-threatening"
```

The command prints the probability-weighted score:

```text
1.97
```

Levels are zero-indexed. With three levels, the score ranges from `0` to `2` and may be fractional. `--levels` must be followed by at least two descriptions and should be the final flag in the command.

## Command contract

All subcommands require:

| Flag | Meaning |
| --- | --- |
| `--state <file>` | Path to a JSON file parsed before the API request |
| `--prompt <text>` | Question TypeSafe evaluates against the state |

Question-specific arguments:

| Subcommand | Arguments | Output |
| --- | --- | --- |
| `choice` | `--choices <label> <label> [...]` | Selected label |
| `noul` | None | Probability of yes |
| `score` | `--levels <description> <description> [...]` | Probability-weighted level index |

The SDK uses its default `jev-latest` model. Successful commands write one machine-readable value followed by a newline, making the CLI suitable for shell composition.

## Errors

The CLI exits unsuccessfully when:

- `TYPESAFE_API_KEY` is missing or invalid;
- the state file is missing or invalid JSON;
- the state has an unsupported top-level JSON type;
- Choice receives fewer than two unique labels;
- Score receives fewer than two levels; or
- the TypeSafe API request fails.

Errors are rendered by Effect CLI on standard error.

## Development

Type-check the project:

```bash
bun run typecheck
```

Key dependencies:

- `effect` and `@effect/platform-bun` `4.0.0-rc.117`
- `@typesafe-ai/sdk` `0.6.x`

The implementation is contained in `index.ts`. Effect CLI parses each subcommand, Bun services provide filesystem and terminal capabilities, and `TypeSafeClient.systemOne` performs the typed judgment.
