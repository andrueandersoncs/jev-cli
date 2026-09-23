#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import packageMetadata from "./package.json" with { type: "json" };
import {
  choice,
  type ChoiceCriteria,
  type EntryType,
  type Questions,
  noul,
  score,
  type SystemOneRequest,
  type SystemOneResult,
  TypeSafeClient,
} from "@typesafe-ai/sdk";
import { Console, Effect, Option } from "effect";
import { Argument, CliError, Command, Flag } from "effect/unstable/cli";

const userError = (message: string) =>
  new CliError.UserError({ cause: new Error(message) });

const jsonFlag = (name: string) =>
  Flag.String(name).pipe(
    Flag.mapTryCatch(
      (value) => JSON.parse(value) as unknown,
      () => `--${name} must contain valid JSON`,
    ),
  );

const state = jsonFlag("state").pipe(
  Flag.withDescription("Inline JSON state"),
);

const stateFile = Flag.FileParse("state-file", { format: "json" }).pipe(
  Flag.withDescription("Path to a JSON state file"),
);
const stateText = Flag.String("text").pipe(
  Flag.withDescription("Inline plain-text state"),
);

const stateStdin = Flag.Boolean("stdin").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Read plain-text state from standard input"),
);

const prompt = Flag.String("prompt").pipe(
  Flag.withDescription("Inline question to answer about the state"),
);

const promptFile = Flag.FileText("prompt-file").pipe(
  Flag.withDescription("Path to a text file containing the question"),
);
const trueCriteria = Flag.String("true-criteria").pipe(
  Flag.withDescription("Description of what a yes answer means"),
);

const falseCriteria = Flag.String("false-criteria").pipe(
  Flag.withDescription("Description of what a no answer means"),
);

const questions = jsonFlag("questions").pipe(
  Flag.withDescription("Inline JSON map of named TypeSafe questions"),
);

const questionsFile = Flag.FileParse("questions-file", {
  format: "json",
}).pipe(
  Flag.withDescription("Path to a JSON map of named TypeSafe questions"),
);

const choicesFlag = Flag.Boolean("choices").pipe(
  Flag.withDescription("Read the remaining arguments as possible answers"),
);

const choicesFile = Flag.FileParse("choices-file", { format: "json" }).pipe(
  Flag.withDescription("Path to a JSON array of possible answers"),
);
const choiceCriteria = jsonFlag("criteria").pipe(
  Flag.withDescription("Inline JSON map of choice labels to descriptions"),
);

const choiceCriteriaFile = Flag.FileParse("criteria-file", {
  format: "json",
}).pipe(
  Flag.withDescription(
    "Path to a JSON map of choice labels to descriptions",
  ),
);

const choiceValues = Argument.String("choice").pipe(
  Argument.atMost(Number.MAX_SAFE_INTEGER),
  Argument.withDescription("Two or more possible answers"),
);

const levelsFlag = Flag.Boolean("levels").pipe(
  Flag.withDescription("Read the remaining arguments as ordered score levels"),
);

const levelsFile = Flag.FileParse("levels-file", { format: "json" }).pipe(
  Flag.withDescription("Path to a JSON array of ordered score levels"),
);

const levelValues = Argument.String("level").pipe(
  Argument.atMost(Number.MAX_SAFE_INTEGER),
  Argument.withDescription("Two or more ordered score descriptions"),
);
const outputFormat = Flag.Literals("format", [
  "value",
  "json",
  "response",
]).pipe(
  Flag.withDefault("value"),
  Flag.withDescription("Output the scalar value, typed answer, or full response"),
);

const dryRun = Flag.Boolean("dry-run").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Print the SDK request without calling the API"),
);

const resolveInput = <A>(
  name: string,
  inline: Option.Option<A>,
  file: Option.Option<A>,
): Effect.Effect<A, CliError.UserError> => {
  if (Option.isSome(inline) && Option.isSome(file)) {
    return Effect.fail(
      userError(`Pass only one of --${name} or --${name}-file`),
    );
  }

  if (Option.isSome(inline)) {
    return Effect.succeed(inline.value);
  }

  if (Option.isSome(file)) {
    return Effect.succeed(file.value);
  }

  return Effect.fail(
    userError(`Pass exactly one of --${name} or --${name}-file`),
  );
};
const toStringArray = (
  name: string,
  value: unknown,
): Effect.Effect<ReadonlyArray<string>, CliError.UserError> => {
  if (
    !Array.isArray(value) ||
    !value.every((item): item is string => typeof item === "string")
  ) {
    return Effect.fail(
      userError(`--${name}-file must contain a JSON array of strings`),
    );
  }

  return Effect.succeed(value);
};


const resolveListInput = (
  name: string,
  inlineFlag: Option.Option<boolean>,
  inlineValues: ReadonlyArray<string>,
  file: Option.Option<unknown>,
): Effect.Effect<ReadonlyArray<string>, CliError.UserError> => {
  if (Option.isSome(inlineFlag) && !inlineFlag.value) {
    return Effect.fail(userError(`--no-${name} is not supported`));
  }

  const inlineRequested =
    Option.isSome(inlineFlag) && inlineFlag.value === true;

  if (inlineValues.length > 0 && !inlineRequested) {
    return Effect.fail(
      userError(`Pass inline ${name} after the --${name} flag`),
    );
  }

  const inline: Option.Option<unknown> = inlineRequested
    ? Option.some(inlineValues)
    : Option.none();

  return resolveInput(name, inline, file).pipe(
    Effect.flatMap((value) => toStringArray(name, value)),
  );
};

const isEntryType = (value: unknown): value is EntryType =>
  value === null ||
  typeof value === "string" ||
  Array.isArray(value) ||
  (typeof value === "object" && value !== null);

const toState = (value: unknown) =>
  isEntryType(value)
    ? Effect.succeed(value)
    : Effect.fail(
        userError("State must be a JSON string, object, array, or null"),
      );

const resolveStateInput = (
  inline: Option.Option<unknown>,
  file: Option.Option<unknown>,
  text: Option.Option<string>,
  readStdin: boolean,
): Effect.Effect<EntryType, CliError.UserError> =>
  Effect.gen(function* () {
    const sourceCount =
      Number(Option.isSome(inline)) +
      Number(Option.isSome(file)) +
      Number(Option.isSome(text)) +
      Number(readStdin);

    if (sourceCount !== 1) {
      return yield* userError(
        "Pass exactly one of --state, --state-file, --text, or --stdin",
      );
    }

    if (Option.isSome(inline)) {
      return yield* toState(inline.value);
    }

    if (Option.isSome(file)) {
      return yield* toState(file.value);
    }

    if (Option.isSome(text)) {
      return text.value;
    }

    return yield* Effect.tryPromise({
      try: () => Bun.stdin.text(),
      catch: (cause) => new CliError.UserError({ cause }),
    });
  });

const toChoiceCriteria = (
  value: unknown,
): Effect.Effect<ChoiceCriteria, CliError.UserError> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return Effect.fail(
      userError(
        "Criteria must be a JSON object mapping labels to descriptions",
      ),
    );
  }

  const entries = Object.entries(value);
  if (entries.length < 2) {
    return Effect.fail(
      userError("Criteria must contain at least two choice labels"),
    );
  }

  if (!entries.every(([, description]) => isEntryType(description))) {
    return Effect.fail(
      userError(
        "Criteria descriptions must be JSON strings, objects, arrays, or null",
      ),
    );
  }

  return Effect.succeed(value as ChoiceCriteria);
};

const resolveChoiceCriteria = (
  choicesFlag: Option.Option<boolean>,
  choiceValues: ReadonlyArray<string>,
  choicesFile: Option.Option<unknown>,
  criteria: Option.Option<unknown>,
  criteriaFile: Option.Option<unknown>,
): Effect.Effect<ChoiceCriteria, CliError.UserError> =>
  Effect.gen(function* () {
    if (Option.isSome(choicesFlag) && !choicesFlag.value) {
      return yield* userError("--no-choices is not supported");
    }

    const inlineChoicesRequested =
      Option.isSome(choicesFlag) && choicesFlag.value === true;

    if (choiceValues.length > 0 && !inlineChoicesRequested) {
      return yield* userError(
        "Pass inline choices after the --choices flag",
      );
    }

    const sourceCount =
      Number(inlineChoicesRequested) +
      Number(Option.isSome(choicesFile)) +
      Number(Option.isSome(criteria)) +
      Number(Option.isSome(criteriaFile));

    if (sourceCount !== 1) {
      return yield* userError(
        "Pass exactly one of --choices, --choices-file, --criteria, or --criteria-file",
      );
    }

    const values = inlineChoicesRequested
      ? choiceValues
      : Option.isSome(choicesFile)
        ? yield* toStringArray("choices", choicesFile.value)
        : undefined;

    if (values !== undefined) {
      const resolvedCriteria = Object.fromEntries(
        values.map((candidate) => [candidate, null]),
      );

      if (Object.keys(resolvedCriteria).length < 2) {
        return yield* userError(
          "Choices must contain at least two unique values",
        );
      }

      return resolvedCriteria;
    }

    if (Option.isSome(criteria)) {
      return yield* toChoiceCriteria(criteria.value);
    }

    if (Option.isSome(criteriaFile)) {
      return yield* toChoiceCriteria(criteriaFile.value);
    }

    return yield* userError(
      "Pass exactly one of --choices, --choices-file, --criteria, or --criteria-file",
    );
  });

const toQuestions = (value: unknown) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0
    ? Effect.succeed(value as Questions)
    : Effect.fail(userError("Questions must be a non-empty JSON object"));

const typeSafeClient = Effect.try({
  try: () => new TypeSafeClient(),
  catch: (cause) => new CliError.UserError({ cause }),
});

const printJson = (value: unknown) =>
  Console.log(JSON.stringify(value, null, 2));

const executeRequest = <Q extends Questions>(
  request: SystemOneRequest<Q>,
  isDryRun: boolean,
): Effect.Effect<
  Option.Option<SystemOneResult<Q>>,
  CliError.UserError
> => {
  if (isDryRun) {
    return printJson(request).pipe(Effect.as(Option.none()));
  }

  return Effect.gen(function* () {
    const client = yield* typeSafeClient;
    const response = yield* Effect.tryPromise({
      try: () => client.systemOne(request),
      catch: (cause) => new CliError.UserError({ cause }),
    });
    return Option.some(response);
  });
};

const printScalarOutput = (
  format: "value" | "json" | "response",
  response: {
    readonly answers: {
      readonly answer: unknown;
    };
  },
  value: string | number,
) =>
  format === "value"
    ? Console.log(value)
    : printJson(format === "json" ? response.answers.answer : response);

const choiceCommand = Command.make(
  "choice",
  {
    state: Flag.optional(state),
    stateFile: Flag.optional(stateFile),
    text: Flag.optional(stateText),
    stdin: stateStdin,
    prompt: Flag.optional(prompt),
    promptFile: Flag.optional(promptFile),
    choicesFlag: Flag.optional(choicesFlag),
    choicesFile: Flag.optional(choicesFile),
    criteria: Flag.optional(choiceCriteria),
    criteriaFile: Flag.optional(choiceCriteriaFile),
    choices: choiceValues,
    format: outputFormat,
    dryRun,
  },
  ({
    state,
    stateFile,
    text,
    stdin,
    prompt,
    promptFile,
    choicesFlag,
    choicesFile,
    criteria,
    criteriaFile,
    choices,
    format,
    dryRun,
  }) =>
    Effect.gen(function* () {
      const validatedState = yield* resolveStateInput(
        state,
        stateFile,
        text,
        stdin,
      );
      const resolvedPrompt = yield* resolveInput("prompt", prompt, promptFile);
      const resolvedCriteria = yield* resolveChoiceCriteria(
        choicesFlag,
        choices,
        choicesFile,
        criteria,
        criteriaFile,
      );
      const request = {
        state: validatedState,
        questions: {
          answer: choice(resolvedPrompt, resolvedCriteria),
        },
      };
      const response = yield* executeRequest(request, dryRun);

      if (Option.isSome(response)) {
        yield* printScalarOutput(
          format,
          response.value,
          response.value.answers.answer.choice,
        );
      }
    }),
).pipe(Command.withDescription("Select one answer from a set of choices"));

const noulCommand = Command.make(
  "noul",
  {
    state: Flag.optional(state),
    stateFile: Flag.optional(stateFile),
    text: Flag.optional(stateText),
    stdin: stateStdin,
    prompt: Flag.optional(prompt),
    promptFile: Flag.optional(promptFile),
    trueCriteria: Flag.optional(trueCriteria),
    falseCriteria: Flag.optional(falseCriteria),
    format: outputFormat,
    dryRun,
  },
  ({
    state,
    stateFile,
    text,
    stdin,
    prompt,
    promptFile,
    trueCriteria,
    falseCriteria,
    format,
    dryRun,
  }) =>
    Effect.gen(function* () {
      const validatedState = yield* resolveStateInput(
        state,
        stateFile,
        text,
        stdin,
      );
      const resolvedPrompt = yield* resolveInput("prompt", prompt, promptFile);
      const criteria =
        Option.isSome(trueCriteria) || Option.isSome(falseCriteria)
          ? {
              ...(Option.isSome(trueCriteria)
                ? { true: trueCriteria.value }
                : {}),
              ...(Option.isSome(falseCriteria)
                ? { false: falseCriteria.value }
                : {}),
            }
          : undefined;
      const request = {
        state: validatedState,
        questions: {
          answer: noul(resolvedPrompt, criteria),
        },
      };
      const response = yield* executeRequest(request, dryRun);

      if (Option.isSome(response)) {
        yield* printScalarOutput(
          format,
          response.value,
          response.value.answers.answer.noul,
        );
      }
    }),
).pipe(Command.withDescription("Return the probability of a yes answer"));

const scoreCommand = Command.make(
  "score",
  {
    state: Flag.optional(state),
    stateFile: Flag.optional(stateFile),
    text: Flag.optional(stateText),
    stdin: stateStdin,
    prompt: Flag.optional(prompt),
    promptFile: Flag.optional(promptFile),
    levelsFlag: Flag.optional(levelsFlag),
    levelsFile: Flag.optional(levelsFile),
    levels: levelValues,
    format: outputFormat,
    dryRun,
  },
  ({
    state,
    stateFile,
    text,
    stdin,
    prompt,
    promptFile,
    levelsFlag,
    levelsFile,
    levels,
    format,
    dryRun,
  }) =>
    Effect.gen(function* () {
      const validatedState = yield* resolveStateInput(
        state,
        stateFile,
        text,
        stdin,
      );
      const resolvedPrompt = yield* resolveInput("prompt", prompt, promptFile);
      const resolvedLevels = yield* resolveListInput(
        "levels",
        levelsFlag,
        levels,
        levelsFile,
      );

      if (resolvedLevels.length < 2) {
        return yield* userError("Levels must contain at least two values");
      }

      const request = {
        state: validatedState,
        questions: {
          answer: score(
            resolvedPrompt,
            resolvedLevels as readonly [
              string,
              string,
              ...Array<string>,
            ],
          ),
        },
      };
      const response = yield* executeRequest(request, dryRun);

      if (Option.isSome(response)) {
        yield* printScalarOutput(
          format,
          response.value,
          response.value.answers.answer.score,
        );
      }
    }),
).pipe(Command.withDescription("Score state against an ordered rubric"));

const cli = Command.make(
  "jev",
  {
    state: Flag.optional(state),
    stateFile: Flag.optional(stateFile),
    text: Flag.optional(stateText),
    stdin: stateStdin,
    questions: Flag.optional(questions),
    questionsFile: Flag.optional(questionsFile),
    dryRun,
  },
  ({
    state,
    stateFile,
    text,
    stdin,
    questions,
    questionsFile,
    dryRun,
  }) =>
    Effect.gen(function* () {
      const validatedState = yield* resolveStateInput(
        state,
        stateFile,
        text,
        stdin,
      );
      const resolvedQuestions = yield* resolveInput(
        "questions",
        questions,
        questionsFile,
      );
      const validatedQuestions = yield* toQuestions(resolvedQuestions);
      const request = {
        state: validatedState,
        questions: validatedQuestions,
      };
      const response = yield* executeRequest(request, dryRun);

      if (Option.isSome(response)) {
        yield* printJson(response.value);
      }
    }),
).pipe(
  Command.withDescription("Ask Jev typed questions about JSON or text state"),
  Command.withSubcommands([choiceCommand, noulCommand, scoreCommand]),
);

Command.run(cli, { version: packageMetadata.version }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);