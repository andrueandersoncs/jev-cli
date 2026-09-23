# jev-cli

A Bun CLI for asking [TypeSafe AI](https://typesafe.ai/) typed questions about JSON or plain-text state. The root command evaluates an API-shaped map of mixed questions in one request; `choice`, `noul`, and `score` provide concise single-question commands for shell scripts. Effect CLI v4 handles arguments and the TypeSafe JavaScript SDK performs each judgment.

## Requirements

- [Bun](https://bun.sh/)
- A TypeSafe API key for live requests

## Setup

Install the CLI globally:

```bash
npm install --global @andrueandersoncs/jev-cli
```

Set your TypeSafe API key:

```bash
export TYPESAFE_API_KEY=your_api_key
```

You can persist the variable in your shell profile or place it in a `.env` file in the directory where you run `jev`. Bun loads that file automatically.

JSON state can be passed inline with `--state` or read from a JSON file with `--state-file`. For example, `state.json`:

```json
{
  "health": 3,
  "enemy": "dragon",
  "inventory": ["smoke bomb"]
}
```

The top-level JSON state may be a string, object, array, or `null`. Use `--text` for unquoted plain text or `--stdin` to pipe plain-text state into the command.

## Usage

```text
jev (--state <json> | --state-file <file> | --text <text> | --stdin) (--questions <json> | --questions-file <file>)
jev <choice|noul|score> [flags]
```

Run `jev --help` or `jev <subcommand> --help` for generated Effect CLI help. For one-off use without a global installation, replace `jev` with `npx @andrueandersoncs/jev-cli`.

### Multiple questions

Evaluate multiple named questions in one TypeSafe request. Inputs may be provided inline:

```bash
jev \
  --state '{"health":3,"enemy":"dragon"}' \
  --questions '{"next_action":{"type":"choice","instructions":"What should the player do next?","criteria":{"run":null,"hide":null,"fight":null}}}'
```

Or read both JSON values from files:

```bash
jev \
  --state-file ./state.json \
  --questions-file ./questions.json
```

Plain-text state does not need JSON string quoting:

```bash
jev \
  --text "The customer was charged twice for one order." \
  --questions '{"is_billing":{"type":"noul","instructions":"Is this a billing issue?"}}'
```

The same state can be piped through standard input:

```bash
cat ticket.txt | jev --stdin --questions-file ./questions.json
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
jev choice \
  --state '{"health":3,"enemy":"dragon"}' \
  --prompt "What should I do next?" \
  --choices run hide fight entice
```

The command prints only the selected label by default:

```text
hide
```

Use criteria when the labels need descriptions that distinguish them:

```bash
jev choice \
  --text "The customer was charged twice for one order." \
  --prompt "Which team should handle this?" \
  --criteria '{
    "billing": "Charges, invoices, and payment failures",
    "shipping": "Delivery delays and lost packages",
    "returns": "Refunds and exchanges"
  }'
```

Criteria can also be stored in a JSON file:

```bash
jev choice \
  --state-file ./ticket.json \
  --prompt-file ./prompt.txt \
  --criteria-file ./teams.json
```

`--criteria` and `--criteria-file` accept a JSON object with at least two labels. Each description may be a JSON string, object, array, or `null`. For undescribed labels, use `--choices <label...>` or a `--choices-file` containing a JSON array of strings.

Pass exactly one of `--choices`, `--choices-file`, `--criteria`, or `--criteria-file`. Inline values after `--choices` may contain spaces when quoted, and `--choices` should be the final flag in the command.

### Noul

Evaluate a yes-or-no question:

```bash
jev noul \
  --text "Production checkout is unavailable for every customer." \
  --prompt "Does this require urgent escalation?"
```

The command prints the probability of **yes**, from `0` to `1`:

```text
0.89
```

Optionally describe either or both outcomes:

```bash
jev noul \
  --state-file ./incident.json \
  --prompt "Does this require urgent escalation?" \
  --true-criteria "Immediate widespread customer impact" \
  --false-criteria "Normal support handling is sufficient"
```

A value near `0` favors no, a value near `1` favors yes, and a value near `0.5` means yes and no have similar probability.

### Score

Evaluate the state against an ordered rubric:

```bash
jev score \
  --text "The export button crashes, but CSV export still works." \
  --prompt "How severe is this issue?" \
  --levels Cosmetic Degraded Blocking
```

The command prints the probability-weighted score:

```text
1.10
```

Levels are zero-indexed. With three levels, the score ranges from `0` to `2` and may be fractional. `--levels` must contain at least two descriptions and should be the final flag in the command. `--levels-file` accepts a JSON array of strings.

### Output formats

Scalar subcommands accept `--format`:

| Format | Output |
| --- | --- |
| `value` | Selected label, yes probability, or weighted score; default |
| `json` | Typed answer with probabilities, confidence when available, and the score legend when applicable |
| `response` | Complete SDK response with `model`, `answers`, and `usage` |

For example:

```bash
jev choice \
  --text "The customer was charged twice." \
  --prompt "Which team should handle this?" \
  --format json \
  --choices billing shipping returns
```

```json
{
  "type": "choice",
  "choice": "billing",
  "confidence": 1,
  "probabilities": {
    "billing": 1,
    "shipping": 0,
    "returns": 0
  }
}
```

The root `jev` command always prints the complete response.

### Dry runs

Add `--dry-run` to any command to validate its CLI inputs and print the exact SDK request without calling the API:

```bash
jev choice \
  --text "The customer was charged twice." \
  --prompt "Which team should handle this?" \
  --criteria-file ./teams.json \
  --dry-run
```

Dry-run output is request JSON regardless of `--format`.

## Command contract

Each command requires exactly one state source:

| Source | Meaning |
| --- | --- |
| `--state <json>` | Inline JSON |
| `--state-file <file>` | JSON read from a file |
| `--text <text>` | Inline plain text |
| `--stdin` | Plain text read from standard input |

Other inputs:

| Input | Accepted forms |
| --- | --- |
| Prompt | Exactly one of `--prompt <text>` or `--prompt-file <file>` |
| Questions | Exactly one of `--questions <json>` or `--questions-file <file>` |
| Choice alternatives | Exactly one of `--choices`, `--choices-file`, `--criteria`, or `--criteria-file` |
| Score levels | Exactly one of `--levels` or `--levels-file` |
| Noul criteria | Optional `--true-criteria` and `--false-criteria` |

JSON files must contain valid JSON. Prompt files contain plain text. `--choices-file` and `--levels-file` contain JSON arrays of strings; criteria files contain JSON objects keyed by choice label.

Mode-specific behavior:

| Mode | Required question inputs | Default output |
| --- | --- | --- |
| root `jev` | Questions | Complete JSON response |
| `choice` | Prompt and choice alternatives | Selected label |
| `noul` | Prompt | Probability of yes |
| `score` | Prompt and levels | Probability-weighted level index |

The SDK uses its default model, currently `jev-latest`. Scalar `value` output is one value followed by a newline for shell composition.

## Errors

The CLI exits unsuccessfully when:

- `TYPESAFE_API_KEY` is missing or invalid for a live request;
- zero or multiple state sources are supplied;
- zero or multiple variants of another required input are supplied;
- an inline JSON value or JSON file is invalid;
- JSON state has an unsupported top-level type;
- questions is empty, not a JSON object, or contains an invalid question;
- choices contains fewer than two unique labels;
- choice criteria is not an object with at least two labels or contains an invalid description;
- levels contains fewer than two values; or
- the TypeSafe API request fails.

Errors are rendered by Effect CLI on standard error. `--dry-run` performs local CLI validation but cannot report server-side validation or authentication failures.

## Development

Type-check the project:

```bash
bun run typecheck
```

Key dependencies:

- `effect` and `@effect/platform-bun` `4.0.0-rc.117`
- `@typesafe-ai/sdk` `0.6.x`

The implementation is contained in `index.ts`. Effect CLI parses the root flags and scalar subcommands, Bun services provide filesystem and terminal capabilities, and `TypeSafeClient.systemOne` performs either one scalar judgment or a mixed-question request.
