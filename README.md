# jev-cli

A small Bun CLI for asking [TypeSafe AI](https://typesafe.ai/) typed questions about JSON state. Passing `--questions` evaluates an API-shaped map of mixed questions in one call; `choice`, `noul`, and `score` remain available as scalar convenience commands. Effect CLI v4 handles arguments and the TypeSafe JavaScript SDK performs each judgment.

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
jev --state <file> --questions <file>
jev <subcommand> [flags]
```

During development, invoke the executable through the package script:

```bash
bun run jev <subcommand> [flags]
```

Run `bun run jev --help` or `bun run jev <subcommand> --help` for generated Effect CLI help.

### Multiple questions

Evaluate multiple named questions in one TypeSafe request by passing `--questions` to the root command:

```bash
bun run jev \
  --state ./state.json \
  --questions ./questions.json
```

`questions.json` uses the TypeSafe API's native question map:

```json
{
  "next_action": {
    "type": "choice",
    "instructions": "What should the player do next?",
    "criteria": {
      "run": "Escape immediately",
      "hide": "Avoid detection and wait",
      "fight": "Attack the threat"
    }
  },
  "should_fight": {
    "type": "noul",
    "instructions": "Should the player fight the dragon?",
    "criteria": {
      "true": "Fighting is likely to achieve the player's goal",
      "false": "Fighting creates unacceptable risk"
    }
  },
  "danger": {
    "type": "score",
    "instructions": "How dangerous is the situation?",
    "criteria": [
      "Safe",
      "Dangerous",
      "Life-threatening"
    ]
  }
}
```

Question IDs such as `next_action` are chosen by the caller. Each answer is returned under its matching ID. Question types may be mixed in the same file and are evaluated in one API call.

The command prints the complete TypeSafe response as JSON, including `model`, `answers`, and `usage`:

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "next_action": {
      "type": "choice",
      "choice": "hide",
      "confidence": 0.81,
      "probabilities": {
        "run": 0.12,
        "hide": 0.81,
        "fight": 0.07
      }
    },
    "should_fight": {
      "type": "noul",
      "noul": 0.11
    },
    "danger": {
      "type": "score",
      "score": 1.97,
      "confidence": 0.73,
      "legend": {
        "0": "Safe",
        "1": "Dangerous",
        "2": "Life-threatening"
      },
      "probabilities": {
        "0": 0.01,
        "1": 0.01,
        "2": 0.98
      }
    }
  },
  "usage": {
    "input_tokens": 420,
    "output_tokens": 96
  }
}
```

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

Every invocation requires:

| Flag | Meaning |
| --- | --- |
| `--state <file>` | Path to a JSON file parsed before the API request |

Mode-specific input and output:

| Mode | Input | Output |
| --- | --- | --- |
| root `jev` | `--questions <file>` | Full JSON response |
| `choice` | `--prompt <text> --choices <label> <label> [...]` | Selected label |
| `noul` | `--prompt <text>` | Probability of yes |
| `score` | `--prompt <text> --levels <description> <description> [...]` | Probability-weighted level index |

The SDK always uses `jev-latest`. The scalar commands write one value followed by a newline for shell composition. A multi-question request writes the API response as formatted JSON.

## Errors

The CLI exits unsuccessfully when:

- `TYPESAFE_API_KEY` is missing or invalid;
- the state file is missing or invalid JSON;
- the state has an unsupported top-level JSON type;
- the questions file is empty, not a JSON object, or contains an invalid question;
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

The implementation is contained in `index.ts`. Effect CLI parses the root flags and scalar subcommands, Bun services provide filesystem and terminal capabilities, and `TypeSafeClient.systemOne` performs either one scalar judgment or a mixed-question request.
